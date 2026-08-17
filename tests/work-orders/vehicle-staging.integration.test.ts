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

async function seed() {
  const orgId = randomUUID();
  const locationId = randomUUID();
  const userId = randomUUID();
  const membershipId = randomUUID();
  const roleId = randomUUID();
  const customerId = randomUUID();

  await dbModule.db.$transaction([
    dbModule.db.organization.create({
      data: { id: orgId, slug: `org-${orgId.slice(0, 8)}`, name: "Stage Org" },
    }),
    dbModule.db.location.create({
      data: { id: locationId, organizationId: orgId, code: "MAIN", name: "Main", timeZone: "UTC" },
    }),
    dbModule.db.user.create({
      data: {
        id: userId,
        email: `s-${userId.slice(0, 8)}@example.test`,
        displayName: "Stage User",
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
        id: customerId,
        organizationId: orgId,
        kind: "INDIVIDUAL",
        displayName: "Stage Customer",
      },
    }),
    dbModule.db.workOrder.create({
      data: {
        organizationId: orgId,
        locationId,
        customerId,
        number: "RO-1201",
        customerConcern: "Stage me",
        status: "IN_PROGRESS",
      },
    }),
  ]);

  const workOrderId = (await dbModule.db.workOrder.findFirst({ where: { organizationId: orgId } }))!
    .id;

  return {
    orgId,
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

describe("vehicle staging (#140)", { skip: shouldSkip }, () => {
  it("sets stage and bay with human activity narration", async () => {
    const { setVehicleStage } = await import("@/modules/work-orders/vehicle-staging-service");
    const seedData = await seed();

    await setVehicleStage({
      db: dbModule.db,
      context: seedData.context(),
      workOrderId: seedData.workOrderId,
      stage: "IN_BAY",
      bayLabel: "Bay 2",
    });

    let workOrder = await dbModule.db.workOrder.findUnique({
      where: { id: seedData.workOrderId },
    });
    expect(workOrder?.vehicleStage).toBe("IN_BAY");
    expect(workOrder?.bayLabel).toBe("Bay 2");

    let activity = await dbModule.db.activityEvent.findFirst({
      where: { workOrderId: seedData.workOrderId, eventType: "vehicle.stage_changed" },
    });
    expect(activity?.summary).toContain("In the bay");
    expect(activity?.summary).toContain("Bay 2");

    // Stage-only change keeps the bay.
    await setVehicleStage({
      db: dbModule.db,
      context: seedData.context(),
      workOrderId: seedData.workOrderId,
      stage: "ON_LIFT",
    });
    workOrder = await dbModule.db.workOrder.findUnique({
      where: { id: seedData.workOrderId },
    });
    expect(workOrder?.vehicleStage).toBe("ON_LIFT");
    expect(workOrder?.bayLabel).toBe("Bay 2");

    // Clearing the bay with an empty string.
    await setVehicleStage({
      db: dbModule.db,
      context: seedData.context(),
      workOrderId: seedData.workOrderId,
      bayLabel: "",
    });
    workOrder = await dbModule.db.workOrder.findUnique({
      where: { id: seedData.workOrderId },
    });
    expect(workOrder?.bayLabel).toBeNull();

    activity = await dbModule.db.activityEvent.findFirst({
      where: { workOrderId: seedData.workOrderId, eventType: "vehicle.stage_changed" },
      orderBy: { occurredAt: "desc" },
    });
    expect(activity?.summary).toContain("Spot cleared");
  });

  it("feeds the customer tracker: ready-for-pickup badge and friendly timeline", async () => {
    const { setVehicleStage } = await import("@/modules/work-orders/vehicle-staging-service");
    const { getOrCreateTrackerLink, buildRepairTrackerView } =
      await import("@/modules/work-orders/tracker-link-service");
    const seedData = await seed();

    const { token } = await getOrCreateTrackerLink({
      db: dbModule.db,
      context: seedData.context(),
      workOrderId: seedData.workOrderId,
    });

    let view = await buildRepairTrackerView(dbModule.db, token);
    expect(view.readyForPickup).toBe(false);

    await setVehicleStage({
      db: dbModule.db,
      context: seedData.context(),
      workOrderId: seedData.workOrderId,
      stage: "READY_FOR_PICKUP",
    });

    view = await buildRepairTrackerView(dbModule.db, token);
    expect(view.readyForPickup).toBe(true);
    expect(view.timeline.map((entry) => entry.label)).toContain("Ready for pickup");
  });

  it("denies cross-organization staging and writes without permission", async () => {
    const { setVehicleStage } = await import("@/modules/work-orders/vehicle-staging-service");
    const seedA = await seed();
    const seedB = await seed();

    await expect(
      setVehicleStage({
        db: dbModule.db,
        context: seedA.context(),
        workOrderId: seedB.workOrderId,
        stage: "IN_BAY",
      }),
    ).rejects.toMatchObject({ reason: "work_order_not_found" });

    const readOnly = {
      ...seedA.context(),
      permissions: new Set(["work_orders.read"] as const),
    };
    await expect(
      setVehicleStage({
        db: dbModule.db,
        context: readOnly,
        workOrderId: seedA.workOrderId,
        stage: "IN_BAY",
      }),
    ).rejects.toThrow();
  });
});
