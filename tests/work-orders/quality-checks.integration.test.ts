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

async function seed(options?: { qualityCheckRequired?: boolean }) {
  const orgId = randomUUID();
  const locationId = randomUUID();
  const userId = randomUUID();
  const membershipId = randomUUID();
  const roleId = randomUUID();
  const customerId = randomUUID();
  const taskId = randomUUID();

  await dbModule.db.$transaction([
    dbModule.db.organization.create({
      data: {
        id: orgId,
        slug: `org-${orgId.slice(0, 8)}`,
        name: "QC Org",
        ...(options?.qualityCheckRequired === false ? { qualityCheckRequired: false } : {}),
      },
    }),
    dbModule.db.location.create({
      data: { id: locationId, organizationId: orgId, code: "MAIN", name: "Main", timeZone: "UTC" },
    }),
    dbModule.db.user.create({
      data: { id: userId, email: `q-${userId.slice(0, 8)}@example.test`, displayName: "QC User" },
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
        displayName: "QC Customer",
      },
    }),
    dbModule.db.workOrder.create({
      data: {
        organizationId: orgId,
        locationId,
        customerId,
        number: "RO-1301",
        customerConcern: "Check my work",
        status: "IN_PROGRESS",
      },
    }),
  ]);

  await dbModule.db.workOrderTask.create({
    data: {
      id: taskId,
      organizationId: orgId,
      locationId,
      workOrderId: (await dbModule.db.workOrder.findFirst({ where: { organizationId: orgId } }))!
        .id,
      position: 1,
      title: "Road test",
      status: "OPEN",
    },
  });

  const workOrderId = (await dbModule.db.workOrder.findFirst({ where: { organizationId: orgId } }))!
    .id;

  return {
    orgId,
    workOrderId,
    taskId,
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

describe("quality checks (#151)", { skip: shouldSkip }, () => {
  it("blocks completion until the check passes, then allows it", async () => {
    const { passQualityCheck, getQualityCheckState } =
      await import("@/modules/work-orders/quality-check-service");
    const { transitionStatus } = await import("@/modules/work-orders/work-order-service");
    const seedData = await seed();

    await expect(
      transitionStatus({
        db: dbModule.db,
        context: seedData.context(),
        workOrderId: seedData.workOrderId,
        targetStatus: "COMPLETED",
      }),
    ).rejects.toMatchObject({ reason: "quality_check_required" });

    // Open checklist item blocks passing.
    await expect(
      passQualityCheck({
        db: dbModule.db,
        context: seedData.context(),
        workOrderId: seedData.workOrderId,
      }),
    ).rejects.toMatchObject({ reason: "open_tasks" });

    await dbModule.db.workOrderTask.update({
      where: { id: seedData.taskId },
      data: { status: "DONE" },
    });

    await passQualityCheck({
      db: dbModule.db,
      context: seedData.context(),
      workOrderId: seedData.workOrderId,
      note: "Road tested, pulls straight",
    });

    const state = await getQualityCheckState({
      db: dbModule.db,
      context: seedData.context(),
      workOrderId: seedData.workOrderId,
    });
    expect(state.status).toBe("passed");
    expect(state.passedByDisplayName).toBe("QC User");
    expect(state.note).toBe("Road tested, pulls straight");

    await transitionStatus({
      db: dbModule.db,
      context: seedData.context(),
      workOrderId: seedData.workOrderId,
      targetStatus: "COMPLETED",
    });

    const activity = await dbModule.db.activityEvent.findFirst({
      where: { workOrderId: seedData.workOrderId, eventType: "quality_check.passed" },
    });
    expect(activity?.summary).toContain("Road tested");
  });

  it("failing the check re-blocks completion and records the reason", async () => {
    const { passQualityCheck, failQualityCheck } =
      await import("@/modules/work-orders/quality-check-service");
    const { transitionStatus } = await import("@/modules/work-orders/work-order-service");
    const seedData = await seed();

    await dbModule.db.workOrderTask.update({
      where: { id: seedData.taskId },
      data: { status: "DONE" },
    });
    await passQualityCheck({
      db: dbModule.db,
      context: seedData.context(),
      workOrderId: seedData.workOrderId,
    });

    await failQualityCheck({
      db: dbModule.db,
      context: seedData.context(),
      workOrderId: seedData.workOrderId,
      note: "Leftover torque wrench in the engine bay",
    });

    await expect(
      transitionStatus({
        db: dbModule.db,
        context: seedData.context(),
        workOrderId: seedData.workOrderId,
        targetStatus: "COMPLETED",
      }),
    ).rejects.toMatchObject({ reason: "quality_check_required" });

    const activity = await dbModule.db.activityEvent.findFirst({
      where: { workOrderId: seedData.workOrderId, eventType: "quality_check.failed" },
    });
    expect(activity?.summary).toContain("torque wrench");
  });

  it("orgs can turn the requirement off", async () => {
    const { transitionStatus } = await import("@/modules/work-orders/work-order-service");
    const seedData = await seed({ qualityCheckRequired: false });

    await transitionStatus({
      db: dbModule.db,
      context: seedData.context(),
      workOrderId: seedData.workOrderId,
      targetStatus: "COMPLETED",
    });

    const workOrder = await dbModule.db.workOrder.findUnique({
      where: { id: seedData.workOrderId },
    });
    expect(workOrder?.status).toBe("COMPLETED");
  });

  it("keeps quality checks tenant-scoped", async () => {
    const { passQualityCheck, getQualityCheckState } =
      await import("@/modules/work-orders/quality-check-service");
    const seedA = await seed();
    const seedB = await seed();

    await expect(
      passQualityCheck({
        db: dbModule.db,
        context: seedA.context(),
        workOrderId: seedB.workOrderId,
      }),
    ).rejects.toMatchObject({ reason: "work_order_not_found" });

    await dbModule.db.workOrderTask.updateMany({
      where: { organizationId: seedB.orgId },
      data: { status: "DONE" },
    });
    await passQualityCheck({
      db: dbModule.db,
      context: seedB.context(),
      workOrderId: seedB.workOrderId,
    });

    const stateA = await getQualityCheckState({
      db: dbModule.db,
      context: seedA.context(),
      workOrderId: seedA.workOrderId,
    });
    expect(stateA.status).toBe("pending");
  });
});
