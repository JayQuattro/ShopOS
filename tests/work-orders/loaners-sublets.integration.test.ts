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
  const shopCustomerId = randomUUID();
  const jobCustomerId = randomUUID();
  const shopCustomerId2 = randomUUID();
  const loanerAssetId = randomUUID();
  const workOrderId = randomUUID();

  await dbModule.db.$transaction([
    dbModule.db.organization.create({
      data: { id: orgId, slug: `org-${orgId.slice(0, 8)}`, name: "Loaner Org" },
    }),
    dbModule.db.location.create({
      data: { id: locationId, organizationId: orgId, code: "MAIN", name: "Main", timeZone: "UTC" },
    }),
    dbModule.db.user.create({
      data: {
        id: userId,
        email: `l-${userId.slice(0, 8)}@example.test`,
        displayName: "Loaner User",
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
        permissions: ["work_orders.read", "work_orders.write"],
      },
    }),
    dbModule.db.membershipRole.create({ data: { organizationId: orgId, membershipId, roleId } }),
    dbModule.db.customer.create({
      data: {
        id: shopCustomerId,
        organizationId: orgId,
        kind: "BUSINESS",
        displayName: "Shop Fleet",
      },
    }),
    dbModule.db.customer.create({
      data: {
        id: shopCustomerId2,
        organizationId: orgId,
        kind: "INDIVIDUAL",
        displayName: "Other Customer",
      },
    }),
    dbModule.db.customer.create({
      data: {
        id: jobCustomerId,
        organizationId: orgId,
        kind: "INDIVIDUAL",
        displayName: "Loaner Customer",
      },
    }),
    dbModule.db.asset.create({
      data: {
        id: loanerAssetId,
        organizationId: orgId,
        customerId: shopCustomerId,
        displayName: "Loaner Civic",
        category: "automobile",
      },
    }),
    dbModule.db.workOrder.create({
      data: {
        id: workOrderId,
        organizationId: orgId,
        locationId,
        customerId: jobCustomerId,
        number: "RO-2201",
        customerConcern: "Loaners and sublets",
        status: "IN_PROGRESS",
      },
    }),
  ]);

  return {
    orgId,
    loanerAssetId,
    workOrderId,
    context: () =>
      ({
        actorId: userId,
        organizationId: orgId,
        membershipId,
        requestId: randomUUID(),
        organizationWideLocationAccess: true,
        allowedLocationIds: new Set<string>(),
        permissions: new Set(["work_orders.read", "work_orders.write"] as const),
      }) as import("@/modules/tenancy/policy").TenantContext,
  };
}

describe("loaners (#173)", { skip: shouldSkip }, () => {
  it("checks out and returns a loaner with mileage and activity", async () => {
    const { checkOutLoaner, checkInLoaner, listLoanersForWorkOrder, listOpenLoaners } =
      await import("@/modules/loaners/loaner-service");
    const seedData = await seedShop();
    const context = seedData.context();

    const { checkoutId } = await checkOutLoaner({
      db: dbModule.db,
      context,
      workOrderId: seedData.workOrderId,
      assetId: seedData.loanerAssetId,
      outMileage: 45120,
      note: "Full tank promised",
    });

    let open = await listOpenLoaners({ db: dbModule.db, context });
    expect(open).toHaveLength(1);
    expect(open[0]?.assetName).toBe("Loaner Civic");
    expect(open[0]?.outMileage).toBe(45120);

    // Same asset can't go out twice; the work order can't hold two loaners.
    await expect(
      checkOutLoaner({
        db: dbModule.db,
        context,
        workOrderId: seedData.workOrderId,
        assetId: seedData.loanerAssetId,
      }),
    ).rejects.toMatchObject({ reason: "asset_already_out" });

    await checkInLoaner({ db: dbModule.db, context, checkoutId, inMileage: 45360 });

    open = await listOpenLoaners({ db: dbModule.db, context });
    expect(open).toHaveLength(0);

    const history = await listLoanersForWorkOrder({
      db: dbModule.db,
      context,
      workOrderId: seedData.workOrderId,
    });
    expect(history).toHaveLength(1);
    expect(history[0]?.inMileage).toBe(45360);

    await expect(checkInLoaner({ db: dbModule.db, context, checkoutId })).rejects.toMatchObject({
      reason: "already_checked_in",
    });

    const activities = await dbModule.db.activityEvent.findMany({
      where: { workOrderId: seedData.workOrderId, eventType: { startsWith: "loaner." } },
    });
    expect(activities.map((a) => a.eventType).sort()).toEqual([
      "loaner.checked_in",
      "loaner.checked_out",
    ]);
  });

  it("keeps loaners tenant-scoped", async () => {
    const { checkOutLoaner } = await import("@/modules/loaners/loaner-service");
    const seedA = await seedShop();
    const seedB = await seedShop();

    await expect(
      checkOutLoaner({
        db: dbModule.db,
        context: seedB.context(),
        workOrderId: seedA.workOrderId,
        assetId: seedA.loanerAssetId,
      }),
    ).rejects.toMatchObject({ reason: "work_order_not_found" });

    await checkOutLoaner({
      db: dbModule.db,
      context: seedA.context(),
      workOrderId: seedA.workOrderId,
      assetId: seedA.loanerAssetId,
    });
    // Org B can't check out org A's loaner asset on their own work order:
    // the asset isn't visible in their tenant.
    await expect(
      checkOutLoaner({
        db: dbModule.db,
        context: seedB.context(),
        workOrderId: seedB.workOrderId,
        assetId: seedA.loanerAssetId,
      }),
    ).rejects.toMatchObject({ reason: "asset_not_found" });
  });
});

describe("sublet work (#173)", { skip: shouldSkip }, () => {
  it("sends, returns with actual cost, and cancels sublet work", async () => {
    const { sendSubletWork, returnSubletWork, cancelSubletWork, listSubletsForWorkOrder } =
      await import("@/modules/work-orders/sublet-service");
    const seedData = await seedShop();
    const context = seedData.context();

    const { subletId } = await sendSubletWork({
      db: dbModule.db,
      context,
      workOrderId: seedData.workOrderId,
      vendorName: "Precision Machine Shop",
      description: "Resurface rotors",
      quotedMinor: 8500,
    });

    const { subletId: cancelledId } = await sendSubletWork({
      db: dbModule.db,
      context,
      workOrderId: seedData.workOrderId,
      vendorName: "Calibration Co",
      description: "ADAS recalibration",
    });
    await cancelSubletWork({ db: dbModule.db, context, subletId: cancelledId });

    await returnSubletWork({ db: dbModule.db, context, subletId, actualMinor: 9000 });

    const sublets = await listSubletsForWorkOrder({
      db: dbModule.db,
      context,
      workOrderId: seedData.workOrderId,
    });
    expect(sublets).toHaveLength(2);
    const returned = sublets.find((s) => s.vendorName === "Precision Machine Shop");
    expect(returned?.status).toBe("returned");
    expect(returned?.quotedMinor).toBe("8500");
    expect(returned?.actualMinor).toBe("9000");
    const cancelled = sublets.find((s) => s.vendorName === "Calibration Co");
    expect(cancelled?.status).toBe("cancelled");

    // Returned sublets can't be returned again or cancelled.
    await expect(returnSubletWork({ db: dbModule.db, context, subletId })).rejects.toMatchObject({
      reason: "already_returned",
    });
    await expect(
      cancelSubletWork({ db: dbModule.db, context, subletId: cancelledId }),
    ).rejects.toMatchObject({ reason: "invalid_transition" });
  });

  it("validates inputs and stays tenant-scoped", async () => {
    const { sendSubletWork } = await import("@/modules/work-orders/sublet-service");
    const seedA = await seedShop();
    const seedB = await seedShop();
    const context = seedA.context();

    await expect(
      sendSubletWork({
        db: dbModule.db,
        context,
        workOrderId: seedA.workOrderId,
        vendorName: "X",
        description: "valid description",
      }),
    ).rejects.toMatchObject({ reason: "invalid_vendor" });
    await expect(
      sendSubletWork({
        db: dbModule.db,
        context,
        workOrderId: seedA.workOrderId,
        vendorName: "Valid Vendor",
        description: "Valid description",
        quotedMinor: -1,
      }),
    ).rejects.toMatchObject({ reason: "invalid_amount" });

    await expect(
      sendSubletWork({
        db: dbModule.db,
        context: seedB.context(),
        workOrderId: seedA.workOrderId,
        vendorName: "Intruder",
        description: "cross-tenant",
      }),
    ).rejects.toMatchObject({ reason: "work_order_not_found" });
  });
});
