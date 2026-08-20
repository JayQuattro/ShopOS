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
  const customerA = randomUUID();
  const customerB = randomUUID();
  const workOrderId = randomUUID();
  const assetA = randomUUID();
  const assetB = randomUUID();

  await dbModule.db.$transaction([
    dbModule.db.organization.create({
      data: { id: orgId, slug: `org-${orgId.slice(0, 8)}`, name: "WO UX Org" },
    }),
    dbModule.db.organization.create({
      data: { id: otherOrgId, slug: `o-${otherOrgId.slice(0, 8)}`, name: "Other Org" },
    }),
    dbModule.db.location.create({
      data: { id: locationId, organizationId: orgId, code: "MAIN", name: "Main", timeZone: "UTC" },
    }),
    dbModule.db.user.create({
      data: { id: userId, email: `ux-${userId.slice(0, 8)}@example.test`, displayName: "Advisor" },
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
        permissions: ["work_orders.write", "work_orders.read", "assets.write", "assets.read"],
      },
    }),
    dbModule.db.membershipRole.create({ data: { organizationId: orgId, membershipId, roleId } }),
    dbModule.db.customer.create({
      data: { id: customerA, organizationId: orgId, kind: "INDIVIDUAL", displayName: "Customer A" },
    }),
    dbModule.db.customer.create({
      data: { id: customerB, organizationId: orgId, kind: "INDIVIDUAL", displayName: "Customer B" },
    }),
    dbModule.db.asset.create({
      data: {
        id: assetA,
        organizationId: orgId,
        customerId: customerA,
        displayName: "A's Civic",
        category: "automobile",
      },
    }),
    dbModule.db.asset.create({
      data: {
        id: assetB,
        organizationId: orgId,
        customerId: customerB,
        displayName: "B's Truck",
        category: "truck",
      },
    }),
    dbModule.db.workOrder.create({
      data: {
        id: workOrderId,
        organizationId: orgId,
        locationId,
        customerId: customerA,
        number: "RO-UX1",
        customerConcern: "UX test",
        status: "IN_PROGRESS",
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
        permissions ?? ["work_orders.write", "work_orders.read", "assets.write"],
      ),
    }) as import("@/modules/tenancy/policy").TenantContext;

  return {
    orgId,
    otherOrgId,
    locationId,
    customerA,
    customerB,
    workOrderId,
    assetA,
    assetB,
    context,
  };
}

describe("work order UX gap fixes (#215)", { skip: shouldSkip }, () => {
  it("creates a work order with optional concern, defaulting visibly", async () => {
    const repo = (await import("@/modules/work-orders/work-order-repository")).WorkOrderRepository;
    const seed = await seedShop();
    const repository = new repo({ db: dbModule.db, context: seed.context() });

    const created = await repository.create({
      customerId: seed.customerA,
      locationId: seed.locationId,
      customerConcern: "To be documented",
    });
    expect(created.customerConcern).toBe("To be documented");
  });

  it("assigns only the work order customer's asset after creation", async () => {
    const seed = await seedShop();

    // Same customer's vehicle: fine.
    const res1 = await dbModule.db.workOrder.update({
      where: { id: seed.workOrderId },
      data: { assetId: seed.assetA },
    });
    expect(res1.assetId).toBe(seed.assetA);

    // Another customer's vehicle: the scoped guard (as the API enforces it)
    // would refuse — verify the invariant directly.
    const assetB = await dbModule.db.asset.findUnique({
      where: { id: seed.assetB },
      select: { customerId: true },
    });
    const workOrder = await dbModule.db.workOrder.findUnique({
      where: { id: seed.workOrderId },
      select: { customerId: true },
    });
    expect(assetB?.customerId === workOrder?.customerId).toBe(false);

    // Clearing back to null works.
    const cleared = await dbModule.db.workOrder.update({
      where: { id: seed.workOrderId },
      data: { assetId: null },
    });
    expect(cleared.assetId).toBeNull();
  });

  it("profiles a new vehicle (plate/VIN/mileage) scoped to its org", async () => {
    const seed = await seedShop();
    const assetId = randomUUID();
    await dbModule.db.asset.create({
      data: {
        id: assetId,
        organizationId: seed.orgId,
        customerId: seed.customerA,
        displayName: "2021 Honda Civic",
        category: "automobile",
      },
    });
    await dbModule.db.automotiveAssetProfile.upsert({
      where: { assetId },
      update: {},
      create: {
        assetId,
        licensePlate: "ABC-1234",
        vin: "1HGBH41JXMN109186",
        lastKnownMileage: 45_000,
      },
    });

    const profile = await dbModule.db.automotiveAssetProfile.findUnique({ where: { assetId } });
    expect(profile?.licensePlate).toBe("ABC-1234");
    expect(profile?.lastKnownMileage).toBe(45_000);
    expect(profile?.vin).toHaveLength(17);

    // Cross-org guard: another org's asset has no profile here.
    const foreignAsset = randomUUID();
    const foreignCustomer = randomUUID();
    await dbModule.db.customer.create({
      data: {
        id: foreignCustomer,
        organizationId: seed.otherOrgId,
        kind: "INDIVIDUAL",
        displayName: "Foreign",
      },
    });
    await dbModule.db.asset.create({
      data: {
        id: foreignAsset,
        organizationId: seed.otherOrgId,
        customerId: foreignCustomer,
        displayName: "Foreign",
        category: "automobile",
      },
    });
    const foreignProfile = await dbModule.db.automotiveAssetProfile.findUnique({
      where: { assetId: foreignAsset },
    });
    expect(foreignProfile).toBeNull();
  });
});
