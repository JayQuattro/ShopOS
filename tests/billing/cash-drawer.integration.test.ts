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
  const otherLocationId = randomUUID();
  const userId = randomUUID();
  const membershipId = randomUUID();
  const roleId = randomUUID();
  const customerId = randomUUID();
  const workOrderId = randomUUID();
  const invoiceId = randomUUID();
  const otherOrgCustomerId = randomUUID();
  const otherWorkOrderId = randomUUID();
  const otherInvoiceId = randomUUID();

  await dbModule.db.$transaction([
    dbModule.db.organization.create({
      data: { id: orgId, slug: `org-${orgId.slice(0, 8)}`, name: "Drawer Org" },
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
    dbModule.db.customer.create({
      data: {
        id: otherOrgCustomerId,
        organizationId: otherOrgId,
        kind: "INDIVIDUAL",
        displayName: "Other Payer",
      },
    }),
    dbModule.db.workOrder.create({
      data: {
        id: otherWorkOrderId,
        organizationId: otherOrgId,
        locationId: otherLocationId,
        customerId: otherOrgCustomerId,
        number: "WO-OTHER",
        customerConcern: "Other org drawer test",
      },
    }),
    dbModule.db.invoice.create({
      data: {
        id: otherInvoiceId,
        organizationId: otherOrgId,
        locationId: otherLocationId,
        workOrderId: otherWorkOrderId,
        number: "INV-OTHER",
        status: "ISSUED",
        currency: "USD",
        subtotalMinor: 0n,
        discountMinor: 0n,
        taxMinor: 0n,
        totalMinor: 0n,
        issuedAt: new Date(),
      },
    }),
    dbModule.db.user.create({
      data: { id: userId, email: `c-${userId.slice(0, 8)}@example.test`, displayName: "Cashier" },
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
        displayName: "Paying Customer",
      },
    }),
    dbModule.db.workOrder.create({
      data: {
        id: workOrderId,
        organizationId: orgId,
        locationId,
        customerId,
        number: "RO-6601",
        customerConcern: "Drawer test",
      },
    }),
    dbModule.db.invoice.create({
      data: {
        id: invoiceId,
        organizationId: orgId,
        locationId,
        workOrderId,
        number: "INV-6601",
        status: "ISSUED",
        currency: "USD",
        subtotalMinor: 0n,
        discountMinor: 0n,
        taxMinor: 0n,
        totalMinor: 0n,
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
      permissions: new Set<string>(permissions ?? ["payments.record", "work_orders.read"]),
    }) as import("@/modules/tenancy/policy").TenantContext;

  async function addPayment(input: {
    method: "CASH" | "CARD_EXTERNAL" | "CHECK";
    amountMinor: number;
    receivedAt: Date;
    orgId?: string;
    locationId?: string;
  }) {
    await dbModule.db.payment.create({
      data: {
        id: randomUUID(),
        organizationId: input.orgId ?? orgId,
        locationId: input.locationId ?? locationId,
        invoiceId: input.orgId ? otherInvoiceId : invoiceId,
        amountMinor: BigInt(input.amountMinor),
        currency: "USD",
        method: input.method,
        receivedAt: input.receivedAt,
        recordedByUserId: userId,
      },
    });
  }

  return { orgId, otherOrgId, locationId, otherLocationId, context, addPayment };
}

describe("cash drawer (#181)", { skip: shouldSkip }, () => {
  it("opens once per location, totals the window by method, and computes over/short at close", async () => {
    const drawer = await import("@/modules/billing/cash-drawer-service");
    const seed = await seedShop();
    const context = seed.context();

    const opened = await drawer.openCashDrawer({
      db: dbModule.db,
      context,
      locationId: seed.locationId,
      currency: "USD",
      openingFloatMinor: 200_00,
    });

    // One open drawer per location.
    await expect(
      drawer.openCashDrawer({
        db: dbModule.db,
        context,
        locationId: seed.locationId,
        currency: "USD",
      }),
    ).rejects.toMatchObject({ reason: "drawer_already_open" });

    const windowStart = new Date(Date.now() - 1000);
    await seed.addPayment({ method: "CASH", amountMinor: 120_00, receivedAt: new Date() });
    await seed.addPayment({ method: "CASH", amountMinor: 30_50, receivedAt: new Date() });
    await seed.addPayment({ method: "CARD_EXTERNAL", amountMinor: 85_25, receivedAt: new Date() });
    // Before the window opened — must not count.
    await seed.addPayment({
      method: "CASH",
      amountMinor: 999_00,
      receivedAt: new Date(windowStart.getTime() - 60 * 60 * 1000),
    });

    const open = await drawer.getOpenCashDrawer({
      db: dbModule.db,
      context,
      locationId: seed.locationId,
    });
    expect(open?.sessionId).toBe(opened.sessionId);
    expect(open?.methodTotals).toEqual({ CASH: 150_50, CARD_EXTERNAL: 85_25 });
    expect(open?.expectedCashMinor).toBe(350_50); // float 200 + cash 150.50
    expect(open?.paymentCount).toBe(3);

    // Count 349.00 in the drawer → 1.50 short.
    const closed = await drawer.closeCashDrawer({
      db: dbModule.db,
      context,
      sessionId: opened.sessionId,
      countedCashMinor: 349_00,
      note: "small shortage noted",
    });
    expect(closed.overShortMinor).toBe(-150);

    const history = await drawer.listClosedCashDrawers({ db: dbModule.db, context });
    expect(history).toHaveLength(1);
    expect(history[0]?.methodTotals).toEqual({ CASH: 150_50, CARD_EXTERNAL: 85_25 });
    expect(history[0]?.expectedCashMinor).toBe(350_50);
    expect(history[0]?.countedCashMinor).toBe(349_00);
    expect(history[0]?.overShortMinor).toBe(-150);
    expect(history[0]?.note).toBe("small shortage noted");

    // Closed stays closed; the audit trail recorded the close.
    await expect(
      drawer.closeCashDrawer({
        db: dbModule.db,
        context,
        sessionId: opened.sessionId,
        countedCashMinor: 0,
      }),
    ).rejects.toMatchObject({ reason: "session_not_open" });
    const audits = await dbModule.db.auditEvent.findMany({
      where: {
        action: "cash_drawer.closed",
        entityType: "cash_drawer_session",
        entityId: opened.sessionId,
      },
    });
    expect(audits).toHaveLength(1);

    // A new drawer can open after closing.
    const reopened = await drawer.openCashDrawer({
      db: dbModule.db,
      context,
      locationId: seed.locationId,
      currency: "USD",
      openingFloatMinor: 200_00,
    });
    expect(reopened.sessionId).not.toBe(opened.sessionId);
  });

  it("never mixes organizations or locations", async () => {
    const drawer = await import("@/modules/billing/cash-drawer-service");
    const seed = await seedShop();
    const context = seed.context();

    await drawer.openCashDrawer({
      db: dbModule.db,
      context,
      locationId: seed.locationId,
      currency: "USD",
      openingFloatMinor: 100_00,
    });

    // Another organization's context cannot see or open this location's drawer.
    const otherContext = seed.context(undefined, seed.otherOrgId);
    expect(
      await drawer.getOpenCashDrawer({
        db: dbModule.db,
        context: otherContext,
        locationId: seed.locationId,
      }),
    ).toBeNull();
    await expect(
      drawer.openCashDrawer({
        db: dbModule.db,
        context: otherContext,
        locationId: seed.locationId,
        currency: "USD",
      }),
    ).rejects.toMatchObject({ reason: "location_not_found" });

    // Payments at the other organization's location don't inflate this drawer.
    await seed.addPayment({
      method: "CASH",
      amountMinor: 500_00,
      receivedAt: new Date(),
      orgId: seed.otherOrgId,
      locationId: seed.otherLocationId,
    });
    const open = await drawer.getOpenCashDrawer({
      db: dbModule.db,
      context,
      locationId: seed.locationId,
    });
    expect(open?.expectedCashMinor).toBe(100_00);
  });

  it("requires payment-record permission and rejects bad amounts", async () => {
    const drawer = await import("@/modules/billing/cash-drawer-service");
    const { TenantAccessDenied } = await import("@/modules/tenancy/policy");
    const seed = await seedShop();

    const viewer = seed.context(["work_orders.read"]);
    await expect(
      drawer.openCashDrawer({
        db: dbModule.db,
        context: viewer,
        locationId: seed.locationId,
        currency: "USD",
      }),
    ).rejects.toThrowError(TenantAccessDenied);
    await expect(
      drawer.listClosedCashDrawers({ db: dbModule.db, context: viewer }),
    ).rejects.toThrowError(TenantAccessDenied);

    const context = seed.context();
    await expect(
      drawer.openCashDrawer({
        db: dbModule.db,
        context,
        locationId: seed.locationId,
        currency: "USD",
        openingFloatMinor: -5,
      }),
    ).rejects.toMatchObject({ reason: "invalid_amount" });

    const opened = await drawer.openCashDrawer({
      db: dbModule.db,
      context,
      locationId: seed.locationId,
      currency: "USD",
    });
    await expect(
      drawer.closeCashDrawer({
        db: dbModule.db,
        context,
        sessionId: opened.sessionId,
        countedCashMinor: -1,
      }),
    ).rejects.toMatchObject({ reason: "invalid_amount" });
    await expect(
      drawer.closeCashDrawer({
        db: dbModule.db,
        context,
        sessionId: randomUUID(),
        countedCashMinor: 0,
      }),
    ).rejects.toMatchObject({ reason: "session_not_found" });
  });
});
