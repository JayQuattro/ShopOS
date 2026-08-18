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
  const shopCustomerId = randomUUID();
  const jobCustomerId = randomUUID();
  const truckAssetId = randomUUID();
  const vanAssetId = randomUUID();
  const customerCarAssetId = randomUUID();
  const otherOrgAssetId = randomUUID();
  const otherOrgCustomerId = randomUUID();
  const workOrderId = randomUUID();

  await dbModule.db.$transaction([
    dbModule.db.organization.create({
      data: { id: orgId, slug: `org-${orgId.slice(0, 8)}`, name: "Fleet Org" },
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
        email: `f-${userId.slice(0, 8)}@example.test`,
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
        permissions: ["assets.read", "assets.write", "work_orders.read", "work_orders.write"],
      },
    }),
    dbModule.db.membershipRole.create({ data: { organizationId: orgId, membershipId, roleId } }),
    dbModule.db.customer.create({
      data: {
        id: shopCustomerId,
        organizationId: orgId,
        kind: "BUSINESS",
        displayName: "Fleet Org Vehicles",
      },
    }),
    dbModule.db.customer.create({
      data: {
        id: jobCustomerId,
        organizationId: orgId,
        kind: "INDIVIDUAL",
        displayName: "Loan Customer",
      },
    }),
    dbModule.db.customer.create({
      data: {
        id: otherOrgCustomerId,
        organizationId: otherOrgId,
        kind: "INDIVIDUAL",
        displayName: "Other Org Customer",
      },
    }),
    dbModule.db.asset.create({
      data: {
        id: truckAssetId,
        organizationId: orgId,
        customerId: shopCustomerId,
        displayName: "Service Truck 1",
        category: "truck",
        isFleetVehicle: true,
      },
    }),
    dbModule.db.asset.create({
      data: {
        id: vanAssetId,
        organizationId: orgId,
        customerId: shopCustomerId,
        displayName: "Loaner Van",
        category: "van",
      },
    }),
    dbModule.db.asset.create({
      data: {
        id: customerCarAssetId,
        organizationId: orgId,
        customerId: jobCustomerId,
        displayName: "Customer Civic",
        category: "automobile",
      },
    }),
    dbModule.db.asset.create({
      data: {
        id: otherOrgAssetId,
        organizationId: otherOrgId,
        customerId: otherOrgCustomerId,
        displayName: "Other Org Truck",
        category: "truck",
        isFleetVehicle: true,
      },
    }),
    dbModule.db.workOrder.create({
      data: {
        id: workOrderId,
        organizationId: orgId,
        locationId,
        customerId: jobCustomerId,
        number: "RO-3301",
        customerConcern: "Fleet test job",
      },
    }),
  ]);

  // Automotive profile for the fleet truck so plate/mileage render.
  await dbModule.db.automotiveAssetProfile.create({
    data: {
      assetId: truckAssetId,
      licensePlate: "SHOP-1",
      plateJurisdiction: "NC",
      lastKnownMileage: 88_214,
    },
  });

  const context = (permissions?: readonly string[]) =>
    ({
      actorId: userId,
      organizationId: orgId,
      membershipId,
      requestId: randomUUID(),
      organizationWideLocationAccess: true,
      allowedLocationIds: new Set<string>(),
      permissions: new Set<string>(
        permissions ?? ["assets.read", "assets.write", "work_orders.read", "work_orders.write"],
      ),
    }) as import("@/modules/tenancy/policy").TenantContext;

  return {
    orgId,
    otherOrgId,
    truckAssetId,
    vanAssetId,
    customerCarAssetId,
    otherOrgAssetId,
    jobCustomerId,
    shopCustomerId,
    workOrderId,
    context,
  };
}

describe("fleet (#176)", { skip: shouldSkip }, () => {
  it("lists fleet vehicles with plate, mileage, loaner state, and roadside calls", async () => {
    const fleet = await import("@/modules/assets/fleet-service");
    const service = await import("@/modules/service-calls/service-call-service");
    const seed = await seedShop();
    const context = seed.context();

    // The truck is out on loan and assigned to an open roadside call.
    await dbModule.db.loanerCheckout.create({
      data: {
        id: randomUUID(),
        organizationId: seed.orgId,
        locationId: (await dbModule.db.location.findFirst({
          where: { organizationId: seed.orgId },
        }))!.id,
        workOrderId: seed.workOrderId,
        assetId: seed.truckAssetId,
      },
    });
    const { serviceCallId } = await service.createServiceCall({
      db: dbModule.db,
      context,
      locationId: (await dbModule.db.location.findFirst({ where: { organizationId: seed.orgId } }))!
        .id,
      customerId: seed.jobCustomerId,
      kind: "JUMPSTART",
      contactPhone: "+15550101234",
      addressLine1: "100 Somewhere St",
      city: "Raleigh",
      stateProvince: "NC",
      postalCode: "27601",
    });
    await service.dispatchServiceCall({
      db: dbModule.db,
      context,
      serviceCallId,
      technicianUserId: context.actorId,
      fleetAssetId: seed.truckAssetId,
    });

    const vehicles = await fleet.listFleetVehicles({ db: dbModule.db, context });
    expect(vehicles).toHaveLength(1);
    expect(vehicles[0]?.displayName).toBe("Service Truck 1");
    expect(vehicles[0]?.licensePlate).toBe("SHOP-1");
    expect(vehicles[0]?.plateJurisdiction).toBe("NC");
    expect(vehicles[0]?.mileage).toBe(88_214);
    expect(vehicles[0]?.loanerStatus.out).toBe(true);
    expect(vehicles[0]?.loanerStatus.workOrderNumber).toBe("RO-3301");
    expect(vehicles[0]?.openServiceCalls).toHaveLength(1);

    // The van joins the fleet via the toggle and shows as available.
    await fleet.setFleetVehicle({
      db: dbModule.db,
      context,
      assetId: seed.vanAssetId,
      isFleetVehicle: true,
    });
    const updated = await fleet.listFleetVehicles({ db: dbModule.db, context });
    expect(updated).toHaveLength(2);
    expect(updated.find((vehicle) => vehicle.id === seed.vanAssetId)?.loanerStatus.out).toBe(false);

    // Leaving the fleet is just the flag — the asset stays.
    await fleet.setFleetVehicle({
      db: dbModule.db,
      context,
      assetId: seed.vanAssetId,
      isFleetVehicle: false,
    });
    expect(await fleet.listFleetVehicles({ db: dbModule.db, context })).toHaveLength(1);
  });

  it("prefers fleet vehicles in loaner candidates and falls back to the heuristic", async () => {
    const fleet = await import("@/modules/assets/fleet-service");
    const seed = await seedShop();
    const context = seed.context();

    // With the truck marked fleet, only fleet vehicles are candidates —
    // regardless of customer ownership.
    let candidates = await fleet.listLoanerCandidates({
      db: dbModule.db,
      context,
      excludeCustomerId: seed.jobCustomerId,
    });
    expect(candidates.map((candidate) => candidate.id)).toEqual([seed.truckAssetId]);

    // With no fleet vehicles, the heuristic offers the shop's non-customer
    // assets: the van and the truck (shop-owned), but not the customer's car.
    await fleet.setFleetVehicle({
      db: dbModule.db,
      context,
      assetId: seed.truckAssetId,
      isFleetVehicle: false,
    });
    candidates = await fleet.listLoanerCandidates({
      db: dbModule.db,
      context,
      excludeCustomerId: seed.jobCustomerId,
    });
    expect(candidates.map((candidate) => candidate.id)).toEqual([
      seed.vanAssetId,
      seed.truckAssetId,
    ]);
  });

  it("candidates exclude fleet vehicles and respect organization scope", async () => {
    const fleet = await import("@/modules/assets/fleet-service");
    const seed = await seedShop();
    const context = seed.context();

    const candidates = await fleet.listFleetCandidates({ db: dbModule.db, context });
    expect(candidates.map((candidate) => candidate.id).sort()).toEqual(
      [seed.vanAssetId, seed.customerCarAssetId].sort(),
    );

    // The other org's fleet truck never appears, and its flag cannot be
    // flipped from this org's context.
    expect(candidates.find((candidate) => candidate.id === seed.otherOrgAssetId)).toBeUndefined();
    await expect(
      fleet.setFleetVehicle({
        db: dbModule.db,
        context,
        assetId: seed.otherOrgAssetId,
        isFleetVehicle: false,
      }),
    ).rejects.toMatchObject({ reason: "asset_not_found" });
    const untouched = await dbModule.db.asset.findUnique({
      where: { id: seed.otherOrgAssetId },
      select: { isFleetVehicle: true },
    });
    expect(untouched?.isFleetVehicle).toBe(true);
  });

  it("requires the right permissions for fleet reads and writes", async () => {
    const fleet = await import("@/modules/assets/fleet-service");
    const { TenantAccessDenied } = await import("@/modules/tenancy/policy");
    const seed = await seedShop();

    await expect(
      fleet.listFleetVehicles({ db: dbModule.db, context: seed.context([]) }),
    ).rejects.toThrowError(TenantAccessDenied);

    await expect(
      fleet.setFleetVehicle({
        db: dbModule.db,
        context: seed.context(["assets.read"]),
        assetId: seed.vanAssetId,
        isFleetVehicle: true,
      }),
    ).rejects.toThrowError(TenantAccessDenied);

    // Unchanged after the denied write.
    const van = await dbModule.db.asset.findUnique({
      where: { id: seed.vanAssetId },
      select: { isFleetVehicle: true },
    });
    expect(van?.isFleetVehicle).toBe(false);
  });
});
