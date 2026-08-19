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
  const locationId = randomUUID();
  const userId = randomUUID();
  const membershipId = randomUUID();
  const roleId = randomUUID();
  const customerId = randomUUID();
  const workOrderId = randomUUID();
  const invoiceId = randomUUID();

  await dbModule.db.$transaction([
    dbModule.db.organization.create({
      data: { id: orgId, slug: `org-${orgId.slice(0, 8)}`, name: "Split Org" },
    }),
    dbModule.db.location.create({
      data: { id: locationId, organizationId: orgId, code: "MAIN", name: "Main", timeZone: "UTC" },
    }),
    dbModule.db.user.create({
      data: {
        id: userId,
        email: `st-${userId.slice(0, 8)}@example.test`,
        displayName: "Split User",
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
        permissions: ["work_orders.read", "work_orders.write", "payments.record", "invoices.issue"],
      },
    }),
    dbModule.db.membershipRole.create({ data: { organizationId: orgId, membershipId, roleId } }),
    dbModule.db.customer.create({
      data: {
        id: customerId,
        organizationId: orgId,
        kind: "INDIVIDUAL",
        displayName: "Split Customer",
      },
    }),
    dbModule.db.workOrder.create({
      data: {
        id: workOrderId,
        organizationId: orgId,
        locationId,
        customerId,
        number: "RO-1101",
        customerConcern: "Split tender test",
        status: "INVOICED",
      },
    }),
    dbModule.db.invoice.create({
      data: {
        id: invoiceId,
        organizationId: orgId,
        locationId,
        workOrderId,
        number: "INV-1101",
        status: "ISSUED",
        currency: "USD",
        subtotalMinor: 250_00n,
        discountMinor: 0n,
        taxMinor: 0n,
        totalMinor: 250_00n,
        paidMinor: 0n,
        issuedAt: new Date(),
      },
    }),
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
        permissions ?? ["payments.record", "work_orders.read", "work_orders.write"],
      ),
    }) as import("@/modules/tenancy/policy").TenantContext;

  return { orgId, invoiceId, context };
}

describe("split-tender payments (#186)", { skip: shouldSkip }, () => {
  it("settles one balance with several methods in a single atomic transaction", async () => {
    const service = await import("@/modules/invoices/invoice-service");
    const seed = await seedShop();
    const context = seed.context();

    const result = await service.recordPaymentTenders({
      db: dbModule.db,
      context,
      invoiceId: seed.invoiceId,
      tenders: [
        { amountMinor: 150_00, method: "CARD_EXTERNAL", reference: "auth 4482" },
        { amountMinor: 80_00, method: "CASH" },
        { amountMinor: 20_00, method: "CHECK", reference: "chk 119" },
      ],
    });

    expect(result.invoiceStatus).toBe("PAID");
    expect(result.paymentIds).toHaveLength(3);

    const invoice = await dbModule.db.invoice.findUnique({
      where: { id: seed.invoiceId },
      select: { paidMinor: true, status: true },
    });
    expect(invoice?.paidMinor).toBe(250_00n);
    expect(invoice?.status).toBe("PAID");

    const payments = await dbModule.db.payment.findMany({
      where: { invoiceId: seed.invoiceId },
      orderBy: { amountMinor: "asc" },
    });
    expect(payments.map((p) => `${Number(p.amountMinor)}:${p.method}`)).toEqual([
      "2000:CHECK",
      "8000:CASH",
      "15000:CARD_EXTERNAL",
    ]);
    // Full settlement closed the work order.
    const workOrder = await dbModule.db.workOrder.findUnique({
      where: {
        id: (await dbModule.db.invoice.findUnique({
          where: { id: seed.invoiceId },
          select: { workOrderId: true },
        }))!.workOrderId,
      },
      select: { status: true },
    });
    expect(workOrder?.status).toBe("CLOSED");
  });

  it("keeps partial splits open and rejects over-balance or malformed tenders", async () => {
    const service = await import("@/modules/invoices/invoice-service");
    const seed = await seedShop();
    const context = seed.context();

    const partial = await service.recordPaymentTenders({
      db: dbModule.db,
      context,
      invoiceId: seed.invoiceId,
      tenders: [
        { amountMinor: 100_00, method: "CASH" },
        { amountMinor: 50_00, method: "CARD_EXTERNAL" },
      ],
    });
    expect(partial.invoiceStatus).toBe("PARTIALLY_PAID");

    // Over balance: nothing records, even though the first tender alone fits.
    await expect(
      service.recordPaymentTenders({
        db: dbModule.db,
        context,
        invoiceId: seed.invoiceId,
        tenders: [
          { amountMinor: 50_00, method: "CASH" },
          { amountMinor: 99_99, method: "CHECK" },
        ],
      }),
    ).rejects.toMatchObject({ reason: "payment_exceeds_balance" });
    expect(
      (
        await dbModule.db.invoice.findUnique({
          where: { id: seed.invoiceId },
          select: { paidMinor: true },
        })
      )?.paidMinor,
    ).toBe(150_00n);
    expect(await dbModule.db.payment.count({ where: { invoiceId: seed.invoiceId } })).toBe(2);

    await expect(
      service.recordPaymentTenders({
        db: dbModule.db,
        context,
        invoiceId: seed.invoiceId,
        tenders: [],
      }),
    ).rejects.toMatchObject({ reason: "invalid_tenders" });
    await expect(
      service.recordPaymentTenders({
        db: dbModule.db,
        context,
        invoiceId: seed.invoiceId,
        tenders: [{ amountMinor: 0, method: "CASH" }],
      }),
    ).rejects.toMatchObject({ reason: "invalid_tenders" });
  });

  it("requires payment-record permission", async () => {
    const service = await import("@/modules/invoices/invoice-service");
    const { TenantAccessDenied } = await import("@/modules/tenancy/policy");
    const seed = await seedShop();

    await expect(
      service.recordPaymentTenders({
        db: dbModule.db,
        context: seed.context(["work_orders.read"]),
        invoiceId: seed.invoiceId,
        tenders: [{ amountMinor: 100, method: "CASH" }],
      }),
    ).rejects.toThrowError(TenantAccessDenied);
  });
});

describe("stale payment links (#186)", { skip: shouldSkip }, () => {
  it("records a session that no longer matches the stored link, clamped to the balance", async () => {
    const service = await import("@/modules/billing/processor-payment-service");
    const seed = await seedShop();

    // The shop issued a NEWER link; the customer paid the OLD one from email.
    await dbModule.db.invoice.update({
      where: { id: seed.invoiceId },
      data: { paymentLinkRef: "cs_newer_link" },
    });

    const outcome = await service.recordStripeCheckoutCompleted(dbModule.db, seed.orgId, {
      id: "evt_stale",
      data: {
        object: {
          id: "cs_old_link",
          client_reference_id: seed.invoiceId,
          payment_status: "paid",
          amount_total: 250_00,
          currency: "usd",
        },
      },
    });
    expect(outcome).toMatchObject({ kind: "recorded", amountMinor: 250_00 });
  });
});
