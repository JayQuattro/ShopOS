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

const DAY = 24 * 60 * 60 * 1000;

async function seedShop() {
  const orgId = randomUUID();
  const otherOrgId = randomUUID();
  const locationId = randomUUID();
  const userId = randomUUID();
  const membershipId = randomUUID();
  const roleId = randomUUID();
  const customerId = randomUUID();
  const truckId = randomUUID();

  await dbModule.db.$transaction([
    dbModule.db.organization.create({
      data: { id: orgId, slug: `org-${orgId.slice(0, 8)}`, name: "Fleet Docs Org" },
    }),
    dbModule.db.organization.create({
      data: { id: otherOrgId, slug: `o-${otherOrgId.slice(0, 8)}`, name: "Other Org" },
    }),
    dbModule.db.location.create({
      data: { id: locationId, organizationId: orgId, code: "MAIN", name: "Main", timeZone: "UTC" },
    }),
    dbModule.db.user.create({
      data: {
        id: userId,
        email: `fd-${userId.slice(0, 8)}@example.test`,
        displayName: "Fleet Manager",
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
        permissions: ["assets.read", "assets.write", "work_orders.read"],
      },
    }),
    dbModule.db.membershipRole.create({ data: { organizationId: orgId, membershipId, roleId } }),
    dbModule.db.customer.create({
      data: { id: customerId, organizationId: orgId, kind: "BUSINESS", displayName: "Shop Fleet" },
    }),
    dbModule.db.asset.create({
      data: {
        id: truckId,
        organizationId: orgId,
        customerId,
        displayName: "Service Truck 1",
        category: "truck",
        isFleetVehicle: true,
      },
    }),
    dbModule.db.automotiveAssetProfile.create({
      data: { assetId: truckId, licensePlate: "SHOP-1", lastKnownMileage: 88_000 },
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
        permissions ?? ["assets.read", "assets.write", "work_orders.read"],
      ),
    }) as import("@/modules/tenancy/policy").TenantContext;

  return { orgId, otherOrgId, truckId, context };
}

describe("fleet docs + PM surfacing (#212)", { skip: shouldSkip }, () => {
  it("surfaces document expiries and due maintenance on the fleet list", async () => {
    const fleet = await import("@/modules/assets/fleet-service");
    const seed = await seedShop();

    await dbModule.db.asset.update({
      where: { id: seed.truckId },
      data: {
        registrationExpiresAt: new Date(Date.now() + 10 * DAY),
        insuranceExpiresAt: new Date(Date.now() - 2 * DAY),
      },
    });
    await dbModule.db.maintenanceSchedule.create({
      data: {
        id: randomUUID(),
        organizationId: seed.orgId,
        assetId: seed.truckId,
        name: "Oil change",
        intervalMiles: 5_000,
        lastServicedMileage: 80_000,
      },
    });

    const vehicles = await fleet.listFleetVehicles({ db: dbModule.db, context: seed.context() });
    expect(vehicles).toHaveLength(1);
    const truck = vehicles[0]!;
    expect(truck.registrationExpiresAt).not.toBeNull();
    expect(truck.insuranceExpiresAt).not.toBeNull();

    // Due at 80,000 + 5,000 = 85,000; current 88,000 → 3,000 miles overdue.
    expect(truck.maintenanceDue).toHaveLength(1);
    expect(truck.maintenanceDue[0]?.name).toBe("Oil change");
    expect(truck.maintenanceDue[0]?.dueInMiles).toBe(-3_000);
  });

  it("keeps not-yet-due schedules off the list", async () => {
    const fleet = await import("@/modules/assets/fleet-service");
    const seed = await seedShop();

    await dbModule.db.maintenanceSchedule.create({
      data: {
        id: randomUUID(),
        organizationId: seed.orgId,
        assetId: seed.truckId,
        name: "Tire rotation",
        intervalMiles: 10_000,
        lastServicedMileage: 85_000,
      },
    });

    const vehicles = await fleet.listFleetVehicles({ db: dbModule.db, context: seed.context() });
    // 88,000 − 95,000 = 7,000 miles away — not surfaced.
    expect(vehicles[0]?.maintenanceDue).toHaveLength(0);
  });

  it("scopes doc updates to fleet vehicles in the organization", async () => {
    const fleet = await import("@/modules/assets/fleet-service");
    const { TenantAccessDenied } = await import("@/modules/tenancy/policy");
    const seed = await seedShop();
    const customerCar = randomUUID();
    const otherCustomerId = randomUUID();
    await dbModule.db.customer.create({
      data: {
        id: otherCustomerId,
        organizationId: seed.orgId,
        kind: "INDIVIDUAL",
        displayName: "Other",
      },
    });
    await dbModule.db.asset.create({
      data: {
        id: customerCar,
        organizationId: seed.orgId,
        customerId: otherCustomerId,
        displayName: "Customer Car",
        category: "automobile",
      },
    });

    // Non-fleet asset refused by the fleet-scoped update.
    const updated = await dbModule.db.asset.updateMany({
      where: { id: customerCar, organizationId: seed.orgId, isFleetVehicle: true },
      data: { registrationExpiresAt: new Date() },
    });
    expect(updated.count).toBe(0);

    // Permission gate on listing.
    await expect(
      fleet.listFleetVehicles({ db: dbModule.db, context: seed.context(["work_orders.read"]) }),
    ).rejects.toThrowError(TenantAccessDenied);
  });
});
