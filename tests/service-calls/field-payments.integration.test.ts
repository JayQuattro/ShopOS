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
  const serviceCallId = randomUUID();

  await dbModule.db.$transaction([
    dbModule.db.organization.create({
      data: {
        id: orgId,
        slug: `org-${orgId.slice(0, 8)}`,
        name: "Field Org",
        defaultCurrency: "USD",
      },
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
        email: `fp-${userId.slice(0, 8)}@example.test`,
        displayName: "Field Tech",
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
        permissions: ["work_orders.read", "work_orders.write", "payments.record"],
      },
    }),
    dbModule.db.membershipRole.create({ data: { organizationId: orgId, membershipId, roleId } }),
    dbModule.db.customer.create({
      data: {
        id: customerId,
        organizationId: orgId,
        kind: "INDIVIDUAL",
        displayName: "Stranded Driver",
      },
    }),
    dbModule.db.serviceCall.create({
      data: {
        id: serviceCallId,
        organizationId: orgId,
        locationId,
        customerId,
        kind: "JUMPSTART",
        contactPhone: "+15550101234",
        addressLine1: "1 Roadside Rd",
        city: "Raleigh",
        stateProvince: "NC",
        postalCode: "27601",
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
        permissions ?? ["work_orders.read", "work_orders.write", "payments.record"],
      ),
    }) as import("@/modules/tenancy/policy").TenantContext;

  return { orgId, otherOrgId, locationId, serviceCallId, customerId, userId, context };
}

describe("field collections (#189)", { skip: shouldSkip }, () => {
  it("collects cash on scene into the tech's open till, invisible to AR", async () => {
    const field = await import("@/modules/service-calls/field-payment-service");
    const drawer = await import("@/modules/billing/cash-drawer-service");
    const ar = await import("@/modules/billing/ar-service");
    const seed = await seedShop();
    const context = seed.context();

    // The tech's personal till is open — the collection should land in it.
    const till = await drawer.openCashDrawer({
      db: dbModule.db,
      context,
      locationId: seed.locationId,
      currency: "USD",
      openingFloatMinor: 50_00,
    });

    const { paymentId } = await field.recordFieldPayment({
      db: dbModule.db,
      context,
      serviceCallId: seed.serviceCallId,
      amountMinor: 80_00,
      method: "CASH",
      reference: "on scene",
    });

    const payment = await dbModule.db.payment.findUnique({
      where: { id: paymentId },
      select: { invoiceId: true, serviceCallId: true, drawerSessionId: true, amountMinor: true },
    });
    expect(payment?.invoiceId).toBeNull();
    expect(payment?.serviceCallId).toBe(seed.serviceCallId);
    expect(payment?.drawerSessionId).toBe(till.sessionId);
    expect(payment?.amountMinor).toBe(80_00n);

    // The till sees it; AR does not.
    const drawers = await drawer.getOpenCashDrawers({ db: dbModule.db, context });
    const personal = drawers.find((d) => d.ownerUserId !== null);
    expect(personal?.methodTotals).toEqual({ CASH: 80_00 });
    expect(personal?.expectedCashMinor).toBe(130_00);

    const balances = await ar.listCustomerBalances({ db: dbModule.db, context });
    expect(balances).toHaveLength(0);

    // The collected total sums per call.
    const collected = await field.collectedForServiceCall({
      db: dbModule.db,
      context,
      serviceCallId: seed.serviceCallId,
    });
    expect(collected.totalMinor).toBe(80_00n);
    expect(collected.currency).toBe("USD");

    // Audit trail.
    const audits = await dbModule.db.auditEvent.findMany({
      where: {
        action: "payment.field_recorded",
        entityType: "service_call",
        entityId: seed.serviceCallId,
      },
    });
    expect(audits).toHaveLength(1);
  });

  it("refunds a field collection without touching invoices", async () => {
    const field = await import("@/modules/service-calls/field-payment-service");
    const refunds = await import("@/modules/billing/refund-service");
    const seed = await seedShop();
    const context = seed.context();

    const { paymentId } = await field.recordFieldPayment({
      db: dbModule.db,
      context,
      serviceCallId: seed.serviceCallId,
      amountMinor: 60_00,
      method: "CASH",
    });

    const result = await refunds.refundPayment({
      db: dbModule.db,
      context,
      paymentId,
      amountMinor: 60_00,
      reason: "customer dispute",
    });
    expect(result.processorRefunded).toBe(false);

    const refundRow = await dbModule.db.refund.findFirst({
      where: { paymentId },
      select: { amountMinor: true, reason: true },
    });
    expect(refundRow?.amountMinor).toBe(60_00n);
    expect(refundRow?.reason).toBe("customer dispute");

    // Collected total is gross; refund history lives on the payment.
    const collected = await field.collectedForServiceCall({
      db: dbModule.db,
      context,
      serviceCallId: seed.serviceCallId,
    });
    expect(collected.totalMinor).toBe(60_00n);
  });

  it("rejects foreign calls, bad amounts, and missing permission", async () => {
    const field = await import("@/modules/service-calls/field-payment-service");
    const { TenantAccessDenied } = await import("@/modules/tenancy/policy");
    const seed = await seedShop();
    const context = seed.context();

    await expect(
      field.recordFieldPayment({
        db: dbModule.db,
        context: {
          ...context,
          organizationId: seed.otherOrgId,
        } as import("@/modules/tenancy/policy").TenantContext,
        serviceCallId: seed.serviceCallId,
        amountMinor: 10_00,
        method: "CASH",
      }),
    ).rejects.toMatchObject({ reason: "service_call_not_found" });

    await expect(
      field.recordFieldPayment({
        db: dbModule.db,
        context,
        serviceCallId: seed.serviceCallId,
        amountMinor: 0,
        method: "CASH",
      }),
    ).rejects.toMatchObject({ reason: "invalid_amount" });

    await expect(
      field.recordFieldPayment({
        db: dbModule.db,
        context: seed.context(["work_orders.write"]),
        serviceCallId: seed.serviceCallId,
        amountMinor: 10_00,
        method: "CASH",
      }),
    ).rejects.toThrowError(TenantAccessDenied);

    expect(await dbModule.db.payment.count({ where: { serviceCallId: seed.serviceCallId } })).toBe(
      0,
    );
  });
});
