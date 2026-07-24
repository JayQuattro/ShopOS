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
env.AUTH_EMAIL_DELIVERY = "console";

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

async function seedOrg(): Promise<{
  orgId: string;
  locationId: string;
  customerId: string;
  assetId: string;
  context: () => import("@/modules/tenancy/policy").TenantContext;
}> {
  const orgId = randomUUID();
  const locationId = randomUUID();
  const userId = randomUUID();
  const membershipId = randomUUID();
  const roleId = randomUUID();
  const customerId = randomUUID();
  const assetId = randomUUID();

  await dbModule.db.$transaction([
    dbModule.db.organization.create({
      data: { id: orgId, slug: `org-${orgId.slice(0, 8)}`, name: "WO Test Org" },
    }),
    dbModule.db.location.create({
      data: { id: locationId, organizationId: orgId, code: "MAIN", name: "Main", timeZone: "UTC" },
    }),
    dbModule.db.user.create({
      data: { id: userId, email: `u-${userId.slice(0, 8)}@example.test`, displayName: "WO User" },
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
        permissions: [
          "work_orders.read",
          "work_orders.write",
          "customers.read",
          "customers.write",
          "assets.read",
          "assets.write",
        ],
      },
    }),
    dbModule.db.membershipRole.create({ data: { organizationId: orgId, membershipId, roleId } }),
    dbModule.db.customer.create({
      data: {
        id: customerId,
        organizationId: orgId,
        kind: "INDIVIDUAL",
        displayName: "WO Customer",
      },
    }),
    dbModule.db.asset.create({
      data: {
        id: assetId,
        organizationId: orgId,
        customerId,
        displayName: "Test Car",
        category: "automobile",
      },
    }),
  ]);

  return {
    orgId,
    locationId,
    customerId,
    assetId,
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

describe("WorkOrderRepository CRUD", { skip: shouldSkip }, () => {
  it("creates a work order with auto-generated number", async () => {
    const { WorkOrderRepository } = await import("@/modules/work-orders/work-order-repository");
    const seed = await seedOrg();
    const repo = new WorkOrderRepository({ db: dbModule.db, context: seed.context() });

    const wo = await repo.create({
      customerId: seed.customerId,
      assetId: seed.assetId,
      locationId: seed.locationId,
      customerConcern: "Brake vibration at highway speed.",
    });
    expect(wo.number).toMatch(/^RO-\d+$/);
    expect(wo.status).toBe("DRAFT");
    expect(wo.customerConcern).toContain("Brake");
  });

  it("lists work orders scoped by organization", async () => {
    const { WorkOrderRepository } = await import("@/modules/work-orders/work-order-repository");
    const seed = await seedOrg();
    const repo = new WorkOrderRepository({ db: dbModule.db, context: seed.context() });
    await repo.create({
      customerId: seed.customerId,
      assetId: seed.assetId,
      locationId: seed.locationId,
      customerConcern: "Oil change",
    });
    await repo.create({
      customerId: seed.customerId,
      assetId: seed.assetId,
      locationId: seed.locationId,
      customerConcern: "Tire rotation",
    });

    const list = await repo.list();
    expect(list).toHaveLength(2);
  });

  it("finds a work order by ID with activity feed", async () => {
    const { WorkOrderRepository } = await import("@/modules/work-orders/work-order-repository");
    const seed = await seedOrg();
    const repo = new WorkOrderRepository({ db: dbModule.db, context: seed.context() });
    const wo = await repo.create({
      customerId: seed.customerId,
      assetId: seed.assetId,
      locationId: seed.locationId,
      customerConcern: "Test",
    });

    const detail = await repo.findById(wo.id);
    expect(detail?.activity.length).toBeGreaterThanOrEqual(1);
    expect(detail?.activity[0]?.eventType).toBe("work_order.created");
  });

  it("returns null for cross-org work order lookup", async () => {
    const { WorkOrderRepository } = await import("@/modules/work-orders/work-order-repository");
    const seedA = await seedOrg();
    const seedB = await seedOrg();
    const repoB = new WorkOrderRepository({ db: dbModule.db, context: seedB.context() });
    const wo = await repoB.create({
      customerId: seedB.customerId,
      assetId: seedB.assetId,
      locationId: seedB.locationId,
      customerConcern: "B",
    });

    const repoA = new WorkOrderRepository({ db: dbModule.db, context: seedA.context() });
    const crossOrg = await repoA.findById(wo.id);
    expect(crossOrg).toBeNull();
  });
});

describe("work-order status transitions", { skip: shouldSkip }, () => {
  it("transitions DRAFT to ESTIMATING and writes activity + audit", async () => {
    const { WorkOrderRepository } = await import("@/modules/work-orders/work-order-repository");
    const { transitionStatus } = await import("@/modules/work-orders/work-order-service");
    const seed = await seedOrg();
    const context = seed.context();
    const repo = new WorkOrderRepository({ db: dbModule.db, context });
    const wo = await repo.create({
      customerId: seed.customerId,
      assetId: seed.assetId,
      locationId: seed.locationId,
      customerConcern: "Test",
    });

    await transitionStatus({
      db: dbModule.db,
      context,
      workOrderId: wo.id,
      targetStatus: "ESTIMATING",
    });

    const updated = await repo.findById(wo.id);
    expect(updated?.status).toBe("ESTIMATING");

    // Activity event should include the transition.
    const transitionActivity = updated?.activity.find(
      (a) => a.eventType === "work_order.status_changed",
    );
    expect(transitionActivity).toBeTruthy();

    // Audit event should exist.
    const audit = await dbModule.db.auditEvent.findFirst({
      where: { organizationId: seed.orgId, entityId: wo.id },
    });
    expect(audit).toBeTruthy();
  });

  it("denies an invalid transition (DRAFT directly to IN_PROGRESS)", async () => {
    const { WorkOrderRepository } = await import("@/modules/work-orders/work-order-repository");
    const { transitionStatus } = await import("@/modules/work-orders/work-order-service");
    const { InvalidStatusTransition } =
      await import("@/modules/work-orders/work-order-state-machine");
    const seed = await seedOrg();
    const context = seed.context();
    const repo = new WorkOrderRepository({ db: dbModule.db, context });
    const wo = await repo.create({
      customerId: seed.customerId,
      assetId: seed.assetId,
      locationId: seed.locationId,
      customerConcern: "Test",
    });

    await expect(
      transitionStatus({
        db: dbModule.db,
        context,
        workOrderId: wo.id,
        targetStatus: "IN_PROGRESS",
      }),
    ).rejects.toThrowError(InvalidStatusTransition);
  });

  it("denies transitions out of CLOSED (terminal)", async () => {
    const { WorkOrderRepository } = await import("@/modules/work-orders/work-order-repository");
    const { transitionStatus } = await import("@/modules/work-orders/work-order-service");
    const { InvalidStatusTransition } =
      await import("@/modules/work-orders/work-order-state-machine");
    const seed = await seedOrg();
    const context = seed.context();
    const repo = new WorkOrderRepository({ db: dbModule.db, context });
    const wo = await repo.create({
      customerId: seed.customerId,
      assetId: seed.assetId,
      locationId: seed.locationId,
      customerConcern: "Test",
    });

    // Walk forward to CLOSED.
    for (const status of [
      "ESTIMATING",
      "AWAITING_AUTHORIZATION",
      "AUTHORIZED",
      "IN_PROGRESS",
      "COMPLETED",
      "INVOICED",
      "CLOSED",
    ] as const) {
      await transitionStatus({
        db: dbModule.db,
        context,
        workOrderId: wo.id,
        targetStatus: status,
      });
    }

    // CLOSED → DRAFT is forbidden.
    await expect(
      transitionStatus({ db: dbModule.db, context, workOrderId: wo.id, targetStatus: "DRAFT" }),
    ).rejects.toThrowError(InvalidStatusTransition);
  });
});
