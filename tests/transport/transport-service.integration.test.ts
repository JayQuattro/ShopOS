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
  const driverId = randomUUID();
  const membershipId = randomUUID();
  const roleId = randomUUID();
  const customerId = randomUUID();
  const otherOrgCustomerId = randomUUID();
  const assetId = randomUUID();
  const shopCustomerId = randomUUID();
  const vanAssetId = randomUUID();
  const otherOrgVanId = randomUUID();
  const workOrderId = randomUUID();

  await dbModule.db.$transaction([
    dbModule.db.organization.create({
      data: {
        id: orgId,
        slug: `org-${orgId.slice(0, 8)}`,
        name: "Transport Org",
        addressLine1: "100 Shop Way",
        city: "Redmond",
        stateProvince: "WA",
        postalCode: "98052",
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
        email: `d-${userId.slice(0, 8)}@example.test`,
        displayName: "Dispatcher",
      },
    }),
    dbModule.db.user.create({
      data: {
        id: driverId,
        email: `dr-${driverId.slice(0, 8)}@example.test`,
        displayName: "Courier",
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
    dbModule.db.organizationMembership.create({
      data: {
        id: randomUUID(),
        organizationId: orgId,
        userId: driverId,
        organizationWideLocationAccess: true,
      },
    }),
    dbModule.db.role.create({
      data: {
        id: roleId,
        organizationId: orgId,
        key: "owner",
        name: "Owner",
        permissions: ["work_orders.read", "work_orders.write", "customers.read", "assets.read"],
      },
    }),
    dbModule.db.membershipRole.create({ data: { organizationId: orgId, membershipId, roleId } }),
    dbModule.db.customer.create({
      data: {
        id: customerId,
        organizationId: orgId,
        kind: "INDIVIDUAL",
        displayName: "Door Customer",
      },
    }),
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
        id: otherOrgCustomerId,
        organizationId: otherOrgId,
        kind: "INDIVIDUAL",
        displayName: "Other Org Customer",
      },
    }),
    dbModule.db.asset.create({
      data: {
        id: assetId,
        organizationId: orgId,
        customerId,
        displayName: "Customer SUV",
        category: "automobile",
      },
    }),
    dbModule.db.asset.create({
      data: {
        id: vanAssetId,
        organizationId: orgId,
        customerId: shopCustomerId,
        displayName: "Shop Van",
        category: "van",
        isFleetVehicle: true,
      },
    }),
    dbModule.db.asset.create({
      data: {
        id: otherOrgVanId,
        organizationId: otherOrgId,
        customerId: otherOrgCustomerId,
        displayName: "Other Org Van",
        category: "van",
      },
    }),
    dbModule.db.workOrder.create({
      data: {
        id: workOrderId,
        organizationId: orgId,
        locationId,
        customerId,
        number: "RO-4401",
        customerConcern: "Transport test job",
      },
    }),
  ]);

  return {
    orgId,
    otherOrgId,
    locationId,
    customerId,
    otherOrgCustomerId,
    assetId,
    vanAssetId,
    otherOrgVanId,
    driverId,
    workOrderId,
    context: (permissions?: readonly string[]) =>
      ({
        actorId: userId,
        organizationId: orgId,
        membershipId,
        requestId: randomUUID(),
        organizationWideLocationAccess: true,
        allowedLocationIds: new Set<string>(),
        permissions: new Set<string>(
          permissions ?? ["work_orders.read", "work_orders.write", "customers.read", "assets.read"],
        ),
      }) as import("@/modules/tenancy/policy").TenantContext,
  };
}

const JOB_INPUT = {
  kind: "PICKUP" as const,
  contactPhone: "+15550101234",
  addressLine1: "15001 NE 36th St",
  city: "Redmond",
  stateProvince: "WA",
  postalCode: "98052",
  note: "Parked on level 2 of the garage",
};

describe("transport jobs (#177)", { skip: shouldSkip }, () => {
  it("runs a pickup end to end with console-geocoded address and dispatch ETA", async () => {
    const transport = await import("@/modules/transport/transport-service");
    const seed = await seedShop();
    const context = seed.context();

    const { transportJobId } = await transport.createTransportJob({
      db: dbModule.db,
      context,
      ...JOB_INPUT,
      locationId: seed.locationId,
      customerId: seed.customerId,
      assetId: seed.assetId,
      workOrderId: seed.workOrderId,
    });

    let job = await transport.getTransportJob({ db: dbModule.db, context, transportJobId });
    expect(job?.status).toBe("SCHEDULED");
    expect(job?.kind).toBe("PICKUP");
    expect(job?.assetName).toBe("Customer SUV");
    expect(job?.workOrderNumber).toBe("RO-4401");
    expect(job?.lat).toBeCloseTo(47.639_62, 5);
    expect(job?.geocodedFormatted).toContain("15001 NE 36th St");

    await transport.startTransportJob({
      db: dbModule.db,
      context,
      transportJobId,
      driverUserId: seed.driverId,
      fleetAssetId: seed.vanAssetId,
    });
    job = await transport.getTransportJob({ db: dbModule.db, context, transportJobId });
    expect(job?.status).toBe("EN_ROUTE");
    expect(job?.driverName).toBe("Courier");
    expect(job?.fleetAssetName).toBe("Shop Van");
    expect(job?.etaSeconds).toBe(1020);
    expect(job?.distanceMeters).toBe(12_500);

    await transport.completeTransportJob({ db: dbModule.db, context, transportJobId });
    job = await transport.getTransportJob({ db: dbModule.db, context, transportJobId });
    expect(job?.status).toBe("COMPLETED");
    expect(job?.completedAt).not.toBeNull();

    // Terminal: nothing further moves.
    await expect(
      transport.startTransportJob({
        db: dbModule.db,
        context,
        transportJobId,
        driverUserId: seed.driverId,
      }),
    ).rejects.toMatchObject({ reason: "invalid_transition" });
    await expect(
      transport.cancelTransportJob({
        db: dbModule.db,
        context,
        transportJobId,
        reason: "never mind",
      }),
    ).rejects.toMatchObject({ reason: "invalid_transition" });
  });

  it("cancels an open run with a reason", async () => {
    const transport = await import("@/modules/transport/transport-service");
    const seed = await seedShop();
    const context = seed.context();

    const { transportJobId } = await transport.createTransportJob({
      db: dbModule.db,
      context,
      ...JOB_INPUT,
      locationId: seed.locationId,
      customerId: seed.customerId,
    });

    await transport.cancelTransportJob({
      db: dbModule.db,
      context,
      transportJobId,
      reason: "Customer will drop it off instead",
    });

    const job = await transport.getTransportJob({ db: dbModule.db, context, transportJobId });
    expect(job?.status).toBe("CANCELLED");
    expect(job?.cancelReason).toBe("Customer will drop it off instead");

    await expect(
      transport.completeTransportJob({ db: dbModule.db, context, transportJobId }),
    ).rejects.toMatchObject({ reason: "invalid_transition" });
  });

  it("denies foreign customers, assets, work orders, drivers, and shop vehicles", async () => {
    const transport = await import("@/modules/transport/transport-service");
    const seed = await seedShop();
    const context = seed.context();

    await expect(
      transport.createTransportJob({
        db: dbModule.db,
        context,
        ...JOB_INPUT,
        locationId: seed.locationId,
        customerId: seed.otherOrgCustomerId,
      }),
    ).rejects.toMatchObject({ reason: "customer_not_found" });

    await expect(
      transport.createTransportJob({
        db: dbModule.db,
        context,
        ...JOB_INPUT,
        locationId: seed.locationId,
        customerId: seed.customerId,
        assetId: seed.otherOrgVanId,
      }),
    ).rejects.toMatchObject({ reason: "asset_not_found" });

    const { transportJobId } = await transport.createTransportJob({
      db: dbModule.db,
      context,
      ...JOB_INPUT,
      locationId: seed.locationId,
      customerId: seed.customerId,
    });

    await expect(
      transport.startTransportJob({
        db: dbModule.db,
        context,
        transportJobId,
        driverUserId: randomUUID(),
      }),
    ).rejects.toMatchObject({ reason: "driver_not_a_member" });

    await expect(
      transport.startTransportJob({
        db: dbModule.db,
        context,
        transportJobId,
        driverUserId: seed.driverId,
        fleetAssetId: seed.otherOrgVanId,
      }),
    ).rejects.toMatchObject({ reason: "asset_not_found" });
  });

  it("never leaks or mutates another organization's runs", async () => {
    const transport = await import("@/modules/transport/transport-service");
    const seed = await seedShop();
    const context = seed.context();

    const { transportJobId } = await transport.createTransportJob({
      db: dbModule.db,
      context,
      ...JOB_INPUT,
      locationId: seed.locationId,
      customerId: seed.customerId,
    });

    const otherContext = {
      ...context,
      organizationId: seed.otherOrgId,
      permissions: new Set(["work_orders.read", "work_orders.write"]),
    } as import("@/modules/tenancy/policy").TenantContext;

    expect(
      await transport.getTransportJob({ db: dbModule.db, context: otherContext, transportJobId }),
    ).toBeNull();
    expect(
      await transport.listTransportJobs({ db: dbModule.db, context: otherContext }),
    ).toHaveLength(0);
    await expect(
      transport.startTransportJob({
        db: dbModule.db,
        context: otherContext,
        transportJobId,
        driverUserId: seed.driverId,
      }),
    ).rejects.toMatchObject({ reason: "transport_not_found" });

    const job = await transport.getTransportJob({ db: dbModule.db, context, transportJobId });
    expect(job?.status).toBe("SCHEDULED");
  });

  it("requires write permission for mutations and filters the board", async () => {
    const transport = await import("@/modules/transport/transport-service");
    const { TenantAccessDenied } = await import("@/modules/tenancy/policy");
    const seed = await seedShop();

    await expect(
      transport.createTransportJob({
        db: dbModule.db,
        context: seed.context(["work_orders.read"]),
        ...JOB_INPUT,
        locationId: seed.locationId,
        customerId: seed.customerId,
      }),
    ).rejects.toThrowError(TenantAccessDenied);

    const context = seed.context();
    const pickup = await transport.createTransportJob({
      db: dbModule.db,
      context,
      ...JOB_INPUT,
      locationId: seed.locationId,
      customerId: seed.customerId,
    });
    const delivery = await transport.createTransportJob({
      db: dbModule.db,
      context,
      ...JOB_INPUT,
      kind: "DELIVERY",
      locationId: seed.locationId,
      customerId: seed.customerId,
    });
    await transport.startTransportJob({
      db: dbModule.db,
      context,
      transportJobId: delivery.transportJobId,
      driverUserId: seed.driverId,
    });

    expect(
      await transport.listTransportJobs({ db: dbModule.db, context, openOnly: true }),
    ).toHaveLength(2);
    const pickups = await transport.listTransportJobs({ db: dbModule.db, context, kind: "PICKUP" });
    expect(pickups).toHaveLength(1);
    expect(pickups[0]?.id).toBe(pickup.transportJobId);
    const byDriver = await transport.listTransportJobs({
      db: dbModule.db,
      context,
      driverUserId: seed.driverId,
    });
    expect(byDriver).toHaveLength(1);
    expect(byDriver[0]?.kind).toBe("DELIVERY");
  });
});
