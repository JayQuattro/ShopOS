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

async function seedShop() {
  const orgId = randomUUID();
  const otherOrgId = randomUUID();
  const locationId = randomUUID();
  const userId = randomUUID();
  const membershipId = randomUUID();
  const roleId = randomUUID();
  const customerId = randomUUID();
  const workOrderId = randomUUID();
  const invoiceId = randomUUID();

  await dbModule.db.$transaction([
    dbModule.db.organization.create({
      data: { id: orgId, slug: `org-${orgId.slice(0, 8)}`, name: "Deposit Org" },
    }),
    dbModule.db.organization.create({
      data: { id: otherOrgId, slug: `other-${otherOrgId.slice(0, 8)}`, name: "Other Org" },
    }),
    dbModule.db.location.create({
      data: { id: locationId, organizationId: orgId, code: "MAIN", name: "Main", timeZone: "UTC" },
    }),
    dbModule.db.user.create({
      data: {
        id: userId,
        email: `dp-${userId.slice(0, 8)}@example.test`,
        displayName: "Front Desk",
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
        permissions: ["work_orders.read", "work_orders.write", "payments.record", "customers.read"],
      },
    }),
    dbModule.db.membershipRole.create({ data: { organizationId: orgId, membershipId, roleId } }),
    dbModule.db.customer.create({
      data: {
        id: customerId,
        organizationId: orgId,
        kind: "INDIVIDUAL",
        displayName: "Depositing Customer",
      },
    }),
    dbModule.db.workOrder.create({
      data: {
        id: workOrderId,
        organizationId: orgId,
        locationId,
        customerId,
        number: "RO-7701",
        customerConcern: "Deposit test",
      },
    }),
    dbModule.db.invoice.create({
      data: {
        id: invoiceId,
        organizationId: orgId,
        locationId,
        workOrderId,
        number: "INV-7701",
        status: "ISSUED",
        currency: "USD",
        subtotalMinor: 300_00n,
        discountMinor: 0n,
        taxMinor: 0n,
        totalMinor: 300_00n,
        paidMinor: 0n,
        issuedAt: new Date(),
      },
    }),
  ]);

  const context = (permissions?: readonly string[], organizationIdOverride?: string) =>
    ({
      actorId: userId,
      organizationId: organizationIdOverride ?? orgId,
      membershipId,
      requestId: randomUUID(),
      organizationWideLocationAccess: true,
      allowedLocationIds: new Set<string>(),
      permissions: new Set<string>(
        permissions ?? [
          "work_orders.read",
          "work_orders.write",
          "payments.record",
          "customers.read",
        ],
      ),
    }) as import("@/modules/tenancy/policy").TenantContext;

  return { orgId, otherOrgId, workOrderId, invoiceId, customerId, context };
}

describe("deposits (#182)", { skip: shouldSkip }, () => {
  it("holds a deposit at drop-off, then applies it to the issued invoice", async () => {
    const deposits = await import("@/modules/billing/deposit-service");
    const ar = await import("@/modules/billing/ar-service");
    const seed = await seedShop();
    const context = seed.context();

    const { depositId } = await deposits.recordDeposit({
      db: dbModule.db,
      context,
      workOrderId: seed.workOrderId,
      amountMinor: 100_00,
      currency: "USD",
      method: "CASH",
      note: "Cash at drop-off",
    });

    let open = await deposits.listOpenDeposits({ db: dbModule.db, context });
    expect(open).toHaveLength(1);
    expect(open[0]?.amountMinor).toBe(100_00n);
    expect(open[0]?.workOrderNumber).toBe("RO-7701");
    expect(open[0]?.customerName).toBe("Depositing Customer");

    // The unpaid invoice still shows the full balance while held.
    let balances = await ar.listCustomerBalances({ db: dbModule.db, context });
    expect(balances[0]?.balanceMinor).toBe(300_00n);

    const applied = await deposits.applyDeposit({ db: dbModule.db, context, depositId });
    expect(applied.invoiceId).toBe(seed.invoiceId);

    // Payment recorded, invoice partially paid, AR balance dropped, deposit closed.
    const invoice = await dbModule.db.invoice.findUnique({
      where: { id: seed.invoiceId },
      select: { paidMinor: true, status: true },
    });
    expect(invoice?.paidMinor).toBe(100_00n);
    expect(invoice?.status).toBe("PARTIALLY_PAID");
    balances = await ar.listCustomerBalances({ db: dbModule.db, context });
    expect(balances[0]?.balanceMinor).toBe(200_00n);
    open = await deposits.listOpenDeposits({ db: dbModule.db, context });
    expect(open).toHaveLength(0);

    // Double application is refused; the claim guard holds.
    await expect(
      deposits.applyDeposit({ db: dbModule.db, context, depositId }),
    ).rejects.toMatchObject({ reason: "deposit_already_applied" });
    const payments = await dbModule.db.payment.count({ where: { invoiceId: seed.invoiceId } });
    expect(payments).toBe(1);
  });

  it("rejects deposits larger than the invoice balance and bad amounts", async () => {
    const deposits = await import("@/modules/billing/deposit-service");
    const seed = await seedShop();
    const context = seed.context();

    await expect(
      deposits.recordDeposit({
        db: dbModule.db,
        context,
        workOrderId: seed.workOrderId,
        amountMinor: 0,
        currency: "USD",
        method: "CASH",
      }),
    ).rejects.toMatchObject({ reason: "invalid_amount" });

    const { depositId } = await deposits.recordDeposit({
      db: dbModule.db,
      context,
      workOrderId: seed.workOrderId,
      amountMinor: 500_00,
      currency: "USD",
      method: "CASH",
    });
    await expect(
      deposits.applyDeposit({ db: dbModule.db, context, depositId }),
    ).rejects.toMatchObject({ reason: "deposit_exceeds_balance" });

    // A deposit against a foreign work order never records.
    await expect(
      deposits.recordDeposit({
        db: dbModule.db,
        context,
        workOrderId: randomUUID(),
        amountMinor: 10_00,
        currency: "USD",
        method: "CASH",
      }),
    ).rejects.toMatchObject({ reason: "work_order_not_found" });
  });

  it("never leaks or mutates another organization's deposits", async () => {
    const deposits = await import("@/modules/billing/deposit-service");
    const { TenantAccessDenied } = await import("@/modules/tenancy/policy");
    const seed = await seedShop();
    const context = seed.context();

    const { depositId } = await deposits.recordDeposit({
      db: dbModule.db,
      context,
      workOrderId: seed.workOrderId,
      amountMinor: 50_00,
      currency: "USD",
      method: "CHECK",
    });

    const otherContext = seed.context(undefined, seed.otherOrgId);
    expect(
      await deposits.listOpenDeposits({ db: dbModule.db, context: otherContext }),
    ).toHaveLength(0);
    await expect(
      deposits.applyDeposit({ db: dbModule.db, context: otherContext, depositId }),
    ).rejects.toMatchObject({ reason: "deposit_not_found" });

    // Still open, untouched.
    const open = await deposits.listOpenDeposits({ db: dbModule.db, context });
    expect(open).toHaveLength(1);

    // Money handling needs payment-record access.
    await expect(
      deposits.recordDeposit({
        db: dbModule.db,
        context: seed.context(["work_orders.write"]),
        workOrderId: seed.workOrderId,
        amountMinor: 10_00,
        currency: "USD",
        method: "CASH",
      }),
    ).rejects.toThrowError(TenantAccessDenied);
  });
});
