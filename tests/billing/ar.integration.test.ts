import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { assertDedicatedTestDatabase, resetTestDatabase } from "../helpers/database";

const TEST_DATABASE_URL =
  process.env.SHOPOS_TEST_DATABASE_URL ?? "postgres://shopos:shopos@localhost:5432/shopos_test";
assertDedicatedTestDatabase(TEST_DATABASE_URL);

const env = process.env as Record<string, string | undefined>;
env.DATABASE_URL = TEST_DATABASE_URL;
env.BETTER_AUTH_URL = "http://localhost:3000";
env.BETTER_AUTH_SECRET = "integration-test-secret-at-least-32-characters-long";
env.NODE_ENV = "test";

function isPostgresReachable(url: string): boolean {
  try {
    const probePath = new URL("../identity/_probe-postgres.cjs", import.meta.url);
    execFileSync(process.execPath, [fileURLToPath(probePath)], {
      timeout: 3_000,
      stdio: "ignore",
      env: { ...process.env, SHOPOS_PROBE_URL: url },
    });
    return true;
  } catch {
    return false;
  }
}

const RUN = isPostgresReachable(TEST_DATABASE_URL);
const shouldSkip = !RUN;

type DbModule = typeof import("@/db/client");
let dbModule: DbModule;

beforeAll(async () => {
  if (!RUN) return;
  dbModule = await import("@/db/client");
  await resetTestDatabase(dbModule.db);
}, 30_000);

afterAll(async () => {
  if (!RUN) return;
  await resetTestDatabase(dbModule.db);
  await dbModule.db.$disconnect();
});

beforeEach(async () => {
  if (!RUN) return;
  await resetTestDatabase(dbModule.db);
});

const DAY_MS = 24 * 60 * 60 * 1000;
const AS_OF = new Date("2026-08-16T12:00:00.000Z");

async function seedShop() {
  const orgId = randomUUID();
  const otherOrgId = randomUUID();
  const locationId = randomUUID();
  const userId = randomUUID();
  const membershipId = randomUUID();
  const roleId = randomUUID();

  const otherLocationId = randomUUID();
  await dbModule.db.$transaction([
    dbModule.db.organization.create({
      data: { id: orgId, slug: `org-${orgId.slice(0, 8)}`, name: "AR Org" },
    }),
    dbModule.db.organization.create({
      data: { id: otherOrgId, slug: `other-${otherOrgId.slice(0, 8)}`, name: "Other Org" },
    }),
    dbModule.db.location.create({
      data: { id: locationId, organizationId: orgId, code: "MAIN", name: "Main", timeZone: "UTC" },
    }),
    dbModule.db.location.create({
      data: {
        id: otherLocationId,
        organizationId: otherOrgId,
        code: "MAIN",
        name: "Other Main",
        timeZone: "UTC",
      },
    }),
    dbModule.db.user.create({
      data: {
        id: userId,
        email: `ar-${userId.slice(0, 8)}@example.test`,
        displayName: "Bookkeeper",
      },
    }),
    dbModule.db.organizationMembership.create({
      data: {
        id: membershipId,
        organizationId: orgId,
        userId,
        organizationWideLocationAccess: true,
      },
    }),
    dbModule.db.role.create({
      data: {
        id: roleId,
        organizationId: orgId,
        key: "owner",
        name: "Owner",
        permissions: [
          "work_orders.read",
          "work_orders.write",
          "customers.read",
          "customers.write",
          "invoices.issue",
          "payments.record",
        ],
      },
    }),
    dbModule.db.membershipRole.create({ data: { organizationId: orgId, membershipId, roleId } }),
  ]);

  const context = (permissions?: readonly string[]) =>
    ({
      actorId: userId,
      organizationId: orgId,
      membershipId,
      requestId: randomUUID(),
      organizationWideLocationAccess: true,
      allowedLocationIds: new Set<string>(),
      permissions: new Set<string>(
        permissions ?? [
          "work_orders.read",
          "work_orders.write",
          "customers.read",
          "customers.write",
          "invoices.issue",
          "payments.record",
        ],
      ),
    }) as import("@/modules/tenancy/policy").TenantContext;

  async function addCustomer(id: string, name: string, isAccount = false) {
    await dbModule.db.customer.create({
      data: {
        id,
        organizationId: orgId,
        kind: "INDIVIDUAL",
        displayName: name,
        isAccountCustomer: isAccount,
      },
    });
    return id;
  }

  async function addInvoice(input: {
    customerId: string;
    number: string;
    totalMinor: bigint;
    paidMinor?: bigint;
    issuedDaysAgo: number;
    workOrderId?: string;
    poNumber?: string;
    orgId?: string;
  }) {
    const invoiceOrgId = input.orgId ?? orgId;
    const invoiceLocationId = input.orgId ? otherLocationId : locationId;
    const workOrderId = input.workOrderId ?? randomUUID();
    const [existing] = await dbModule.db.$transaction([
      dbModule.db.workOrder.create({
        data: {
          id: workOrderId,
          organizationId: invoiceOrgId,
          locationId: invoiceLocationId,
          customerId: input.customerId,
          number: `WO-${input.number}`,
          customerConcern: `AR test ${input.number}`,
          ...(input.poNumber ? { poNumber: input.poNumber } : {}),
        },
      }),
      dbModule.db.invoice.create({
        data: {
          id: randomUUID(),
          organizationId: invoiceOrgId,
          locationId: invoiceLocationId,
          workOrderId,
          number: input.number,
          status: "ISSUED",
          currency: "USD",
          subtotalMinor: input.totalMinor,
          discountMinor: 0n,
          taxMinor: 0n,
          totalMinor: input.totalMinor,
          paidMinor: input.paidMinor ?? 0n,
          issuedAt: new Date(AS_OF.getTime() - input.issuedDaysAgo * DAY_MS),
        },
      }),
    ]);
    return existing.id;
  }

  return { orgId, otherOrgId, locationId, context, addCustomer, addInvoice };
}

describe("accounts receivable (#179)", { skip: shouldSkip }, () => {
  it("balances outstanding invoices with aging buckets from the issue date", async () => {
    const ar = await import("@/modules/billing/ar-service");
    const seed = await seedShop();
    const context = seed.context();

    const currentCustomer = await seed.addCustomer(randomUUID(), "Fresh Fleet Co", true);
    const agingCustomer = await seed.addCustomer(randomUUID(), "Slow Pay Inc");
    const paidUpCustomer = await seed.addCustomer(randomUUID(), "All Set LLC");

    await seed.addInvoice({
      customerId: currentCustomer,
      number: "INV-1",
      totalMinor: 100_00n,
      issuedDaysAgo: 5,
    });
    await seed.addInvoice({
      customerId: currentCustomer,
      number: "INV-2",
      totalMinor: 50_00n,
      paidMinor: 20_00n,
      issuedDaysAgo: 10,
    });
    await seed.addInvoice({
      customerId: agingCustomer,
      number: "INV-3",
      totalMinor: 200_00n,
      issuedDaysAgo: 45,
    });
    await seed.addInvoice({
      customerId: agingCustomer,
      number: "INV-4",
      totalMinor: 300_00n,
      issuedDaysAgo: 75,
    });
    await seed.addInvoice({
      customerId: agingCustomer,
      number: "INV-5",
      totalMinor: 400_00n,
      issuedDaysAgo: 120,
    });
    await seed.addInvoice({
      customerId: paidUpCustomer,
      number: "INV-6",
      totalMinor: 80_00n,
      paidMinor: 80_00n,
      issuedDaysAgo: 3,
    });

    const balances = await ar.listCustomerBalances({ db: dbModule.db, context, asOf: AS_OF });

    // Fully paid customers don't appear at all.
    expect(balances.find((b) => b.customerName === "All Set LLC")).toBeUndefined();

    const fresh = balances.find((b) => b.customerName === "Fresh Fleet Co");
    expect(fresh?.isAccountCustomer).toBe(true);
    expect(fresh?.balanceMinor).toBe(130_00n); // 100 + (50 - 20)
    expect(fresh?.currentMinor).toBe(130_00n);
    expect(fresh?.days31to60Minor).toBe(0n);

    const slow = balances.find((b) => b.customerName === "Slow Pay Inc");
    expect(slow?.balanceMinor).toBe(900_00n);
    expect(slow?.currentMinor).toBe(0n);
    expect(slow?.days31to60Minor).toBe(200_00n);
    expect(slow?.days61to90Minor).toBe(300_00n);
    expect(slow?.over90Minor).toBe(400_00n);

    // Sorted largest balance first.
    expect(balances[0]?.customerName).toBe("Slow Pay Inc");
  });

  it("excludes future-dated invoices and other organizations", async () => {
    const ar = await import("@/modules/billing/ar-service");
    const seed = await seedShop();
    const context = seed.context();

    const customer = await seed.addCustomer(randomUUID(), "Mine Inc");
    const otherCustomer = randomUUID();
    await dbModule.db.customer.create({
      data: {
        id: otherCustomer,
        organizationId: seed.otherOrgId,
        kind: "INDIVIDUAL",
        displayName: "Theirs Inc",
      },
    });

    await seed.addInvoice({
      customerId: customer,
      number: "INV-A",
      totalMinor: 100_00n,
      issuedDaysAgo: 2,
    });
    // Not yet issued as of the frozen date.
    await seed.addInvoice({
      customerId: customer,
      number: "INV-F",
      totalMinor: 999_00n,
      issuedDaysAgo: -3,
    });
    // Another organization's invoice, same shape.
    await seed.addInvoice({
      customerId: otherCustomer,
      number: "INV-X",
      totalMinor: 500_00n,
      issuedDaysAgo: 2,
      orgId: seed.otherOrgId,
    });

    const balances = await ar.listCustomerBalances({ db: dbModule.db, context, asOf: AS_OF });
    expect(balances).toHaveLength(1);
    expect(balances[0]?.customerName).toBe("Mine Inc");
    expect(balances[0]?.balanceMinor).toBe(100_00n);
  });

  it("builds a statement with running balance across invoices and payments", async () => {
    const ar = await import("@/modules/billing/ar-service");
    const seed = await seedShop();
    const context = seed.context();

    const customer = await seed.addCustomer(randomUUID(), "Statement Co", true);
    await seed.addInvoice({
      customerId: customer,
      number: "INV-S1",
      totalMinor: 250_00n,
      issuedDaysAgo: 40,
      poNumber: "PO-9",
    });
    await seed.addInvoice({
      customerId: customer,
      number: "INV-S2",
      totalMinor: 100_00n,
      issuedDaysAgo: 10,
    });

    const [invoiceS1] = await dbModule.db.invoice.findMany({
      where: { number: "INV-S1" },
      select: { id: true },
    });
    await dbModule.db.payment.create({
      data: {
        id: randomUUID(),
        organizationId: seed.orgId,
        locationId: seed.locationId,
        invoiceId: invoiceS1.id,
        amountMinor: 100_00n,
        currency: "USD",
        method: "CARD_EXTERNAL",
        reference: "chk 5531",
        receivedAt: new Date(AS_OF.getTime() - 8 * DAY_MS),
        recordedByUserId: context.actorId,
      },
    });
    await dbModule.db.invoice.update({
      where: { id: invoiceS1.id },
      data: { paidMinor: 100_00n },
    });

    const statement = await ar.getCustomerStatement({
      db: dbModule.db,
      context,
      customerId: customer,
      asOf: AS_OF,
    });

    expect(statement?.customerName).toBe("Statement Co");
    expect(statement?.isAccountCustomer).toBe(true);
    expect(statement?.lines.map((line) => line.kind)).toEqual(["invoice", "invoice", "payment"]);
    expect(statement?.lines[0]?.label).toContain("PO-9");
    expect(statement?.lines[0]?.runningBalanceMinor).toBe(250_00n);
    expect(statement?.lines[1]?.runningBalanceMinor).toBe(350_00n);
    expect(statement?.lines[2]?.runningBalanceMinor).toBe(250_00n);
    expect(statement?.balanceMinor).toBe(250_00n); // 350 charged − 100 paid
    expect(statement?.lines[2]?.label).toContain("INV-S1");

    // Foreign customer id → not found in this tenant.
    await expect(
      ar.getCustomerStatement({ db: dbModule.db, context, customerId: randomUUID(), asOf: AS_OF }),
    ).rejects.toMatchObject({ reason: "customer_not_found" });
  });

  it("toggles account billing with an audit trail and permission checks", async () => {
    const ar = await import("@/modules/billing/ar-service");
    const { TenantAccessDenied } = await import("@/modules/tenancy/policy");
    const seed = await seedShop();
    const context = seed.context();
    const customer = await seed.addCustomer(randomUUID(), "Toggle Co");

    await ar.setCustomerAccount({
      db: dbModule.db,
      context,
      customerId: customer,
      isAccountCustomer: true,
    });
    let row = await dbModule.db.customer.findUnique({
      where: { id: customer },
      select: { isAccountCustomer: true },
    });
    expect(row?.isAccountCustomer).toBe(true);

    await ar.setCustomerAccount({
      db: dbModule.db,
      context,
      customerId: customer,
      isAccountCustomer: false,
    });
    row = await dbModule.db.customer.findUnique({
      where: { id: customer },
      select: { isAccountCustomer: true },
    });
    expect(row?.isAccountCustomer).toBe(false);

    const audits = await dbModule.db.auditEvent.findMany({
      where: {
        entityType: "customer",
        entityId: customer,
        action: "customer.account_flag_updated",
      },
      orderBy: { occurredAt: "asc" },
    });
    expect(audits).toHaveLength(2);
    expect(audits[0]?.after).toMatchObject({ isAccountCustomer: true });
    expect(audits[1]?.after).toMatchObject({ isAccountCustomer: false });

    // Wrong org and missing permission both refuse.
    await expect(
      ar.setCustomerAccount({
        db: dbModule.db,
        context,
        customerId: randomUUID(),
        isAccountCustomer: true,
      }),
    ).rejects.toMatchObject({ reason: "customer_not_found" });
    await expect(
      ar.setCustomerAccount({
        db: dbModule.db,
        context: seed.context(["customers.read"]),
        customerId: customer,
        isAccountCustomer: true,
      }),
    ).rejects.toThrowError(TenantAccessDenied);
  });

  it("requires payment-record access for balances and statements", async () => {
    const ar = await import("@/modules/billing/ar-service");
    const { TenantAccessDenied } = await import("@/modules/tenancy/policy");
    const seed = await seedShop();
    const customer = await seed.addCustomer(randomUUID(), "No Peek");

    const viewer = seed.context(["work_orders.read", "customers.read"]);
    await expect(
      ar.listCustomerBalances({ db: dbModule.db, context: viewer, asOf: AS_OF }),
    ).rejects.toThrowError(TenantAccessDenied);
    await expect(
      ar.getCustomerStatement({
        db: dbModule.db,
        context: viewer,
        customerId: customer,
        asOf: AS_OF,
      }),
    ).rejects.toThrowError(TenantAccessDenied);
  });
});
