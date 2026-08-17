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

async function seed(options?: { workOrderStatus?: "AUTHORIZED" | "DRAFT" }) {
  const orgId = randomUUID();
  const locationId = randomUUID();
  const userId = randomUUID();
  const membershipId = randomUUID();
  const roleId = randomUUID();
  const customerId = randomUUID();
  const lineId = randomUUID();

  await dbModule.db.$transaction([
    dbModule.db.organization.create({
      data: { id: orgId, slug: `org-${orgId.slice(0, 8)}`, name: "Task Org" },
    }),
    dbModule.db.location.create({
      data: { id: locationId, organizationId: orgId, code: "MAIN", name: "Main", timeZone: "UTC" },
    }),
    dbModule.db.user.create({
      data: { id: userId, email: `u-${userId.slice(0, 8)}@example.test`, displayName: "Task User" },
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
        permissions: ["work_orders.read", "work_orders.write", "estimates.present"],
      },
    }),
    dbModule.db.membershipRole.create({ data: { organizationId: orgId, membershipId, roleId } }),
    dbModule.db.customer.create({
      data: {
        id: customerId,
        organizationId: orgId,
        kind: "INDIVIDUAL",
        displayName: "Task Customer",
      },
    }),
    dbModule.db.workOrder.create({
      data: {
        organizationId: orgId,
        locationId,
        customerId,
        number: "RO-9501",
        customerConcern: "Inspect",
        status: options?.workOrderStatus ?? "AUTHORIZED",
      },
    }),
  ]);

  const wo = await dbModule.db.workOrder.findFirst({ where: { organizationId: orgId } });

  // An approved baseline so change orders are possible.
  const revision = await dbModule.db.estimateRevision.create({
    data: {
      organizationId: orgId,
      locationId,
      workOrderId: wo!.id,
      revisionNumber: 1,
      status: "PRESENTED",
      documentKind: "BASELINE",
      currency: "USD",
      subtotalMinor: 10000n,
      discountMinor: 0n,
      taxMinor: 0n,
      totalMinor: 10000n,
      presentedAt: new Date(),
      createdByUserId: userId,
    },
  });
  await dbModule.db.estimateLine.create({
    data: {
      id: lineId,
      organizationId: orgId,
      estimateRevisionId: revision.id,
      serviceGroupKey: "general",
      kind: "LABOR",
      description: "Baseline service",
      quantityMilli: 1000,
      unitPriceMinor: 10000n,
      grossMinor: 10000n,
      discountMinor: 0n,
      taxable: false,
      taxRateBasisPoints: 0,
      taxMinor: 0n,
      totalMinor: 10000n,
      position: 1,
    },
  });
  const authorization = await dbModule.db.authorization.create({
    data: {
      id: randomUUID(),
      organizationId: orgId,
      estimateRevisionId: revision.id,
      method: "CUSTOMER_LINK",
      providedByName: "Task Customer",
      occurredAt: new Date(),
    },
  });
  await dbModule.db.authorizationDecision.create({
    data: {
      authorizationId: authorization.id,
      organizationId: orgId,
      estimateLineId: lineId,
      decision: "APPROVED",
    },
  });

  return {
    orgId,
    workOrderId: wo!.id,
    context: () =>
      ({
        actorId: userId,
        organizationId: orgId,
        membershipId,
        requestId: randomUUID(),
        organizationWideLocationAccess: true,
        allowedLocationIds: new Set<string>(),
        permissions: new Set([
          "work_orders.read",
          "work_orders.write",
          "estimates.present",
        ] as const),
      }) as import("@/modules/tenancy/policy").TenantContext,
  };
}

describe("work-order tasks (#136)", { skip: shouldSkip }, () => {
  it("adds tasks, updates statuses, and records activity", async () => {
    const { addTask, listTasks, updateTaskStatus } =
      await import("@/modules/work-orders/task-service");
    const seedData = await seed();

    await addTask({
      db: dbModule.db,
      context: seedData.context(),
      workOrderId: seedData.workOrderId,
      title: "Front brake pads",
    });
    await addTask({
      db: dbModule.db,
      context: seedData.context(),
      workOrderId: seedData.workOrderId,
      title: "Tire tread depth",
    });

    let tasks = await listTasks({
      db: dbModule.db,
      context: seedData.context(),
      workOrderId: seedData.workOrderId,
    });
    expect(tasks).toHaveLength(2);
    expect(tasks.map((task) => task.position)).toEqual([1, 2]);

    await updateTaskStatus({
      db: dbModule.db,
      context: seedData.context(),
      taskId: tasks[0]!.id,
      status: "NEEDS_ATTENTION",
      outcomeNote: "3mm remaining",
    });
    await updateTaskStatus({
      db: dbModule.db,
      context: seedData.context(),
      taskId: tasks[1]!.id,
      status: "DONE",
    });

    tasks = await listTasks({
      db: dbModule.db,
      context: seedData.context(),
      workOrderId: seedData.workOrderId,
    });
    expect(tasks[0]?.status).toBe("NEEDS_ATTENTION");
    expect(tasks[0]?.outcomeNote).toBe("3mm remaining");
    expect(tasks[1]?.status).toBe("DONE");

    const flagged = await dbModule.db.activityEvent.findFirst({
      where: { workOrderId: seedData.workOrderId, eventType: "task.flagged" },
    });
    expect(flagged?.summary).toContain("Front brake pads");
    expect(flagged?.summary).toContain("3mm remaining");
  });

  it("converts flagged tasks into a draft change order with editable zero-price lines", async () => {
    const { addTask, listTasks, updateTaskStatus, createChangeOrderFromFlaggedTasks } =
      await import("@/modules/work-orders/task-service");
    const seedData = await seed();

    await addTask({
      db: dbModule.db,
      context: seedData.context(),
      workOrderId: seedData.workOrderId,
      title: "Front brake pads",
    });
    await addTask({
      db: dbModule.db,
      context: seedData.context(),
      workOrderId: seedData.workOrderId,
      title: "Wiper blades",
    });
    const tasks = await listTasks({
      db: dbModule.db,
      context: seedData.context(),
      workOrderId: seedData.workOrderId,
    });
    await updateTaskStatus({
      db: dbModule.db,
      context: seedData.context(),
      taskId: tasks[0]!.id,
      status: "NEEDS_ATTENTION",
      outcomeNote: "Metal on metal",
    });
    await updateTaskStatus({
      db: dbModule.db,
      context: seedData.context(),
      taskId: tasks[1]!.id,
      status: "DONE",
    });

    const created = await createChangeOrderFromFlaggedTasks({
      db: dbModule.db,
      context: seedData.context(),
      workOrderId: seedData.workOrderId,
    });
    expect(created.changeOrderNumber).toBe(1);
    expect(created.lineCount).toBe(1);

    const revision = await dbModule.db.estimateRevision.findUnique({
      where: { id: created.revisionId },
    });
    expect(revision?.status).toBe("DRAFT");
    expect(revision?.documentKind).toBe("CHANGE_ORDER");
    expect(revision?.summaryNote).toContain("Found during inspection");
    expect(revision?.summaryNote).toContain("Front brake pads");

    const lines = await dbModule.db.estimateLine.findMany({
      where: { estimateRevisionId: created.revisionId },
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]?.description).toContain("Front brake pads");
    expect(lines[0]?.description).toContain("Metal on metal");
    expect(lines[0]?.totalMinor).toBe(0n);
  });

  it("refuses conversion without flagged tasks or on unauthorized work orders", async () => {
    const { addTask, createChangeOrderFromFlaggedTasks } =
      await import("@/modules/work-orders/task-service");
    const seedData = await seed();

    await addTask({
      db: dbModule.db,
      context: seedData.context(),
      workOrderId: seedData.workOrderId,
      title: "All good item",
    });
    await expect(
      createChangeOrderFromFlaggedTasks({
        db: dbModule.db,
        context: seedData.context(),
        workOrderId: seedData.workOrderId,
      }),
    ).rejects.toMatchObject({ reason: "no_flagged_tasks" });

    const draftSeed = await seed({ workOrderStatus: "DRAFT" });
    await expect(
      createChangeOrderFromFlaggedTasks({
        db: dbModule.db,
        context: draftSeed.context(),
        workOrderId: draftSeed.workOrderId,
      }),
    ).rejects.toMatchObject({ reason: "no_flagged_tasks" });
  });

  it("keeps tasks tenant-scoped", async () => {
    const { addTask, updateTaskStatus } = await import("@/modules/work-orders/task-service");
    const seedA = await seed();
    const seedB = await seed();

    await expect(
      addTask({
        db: dbModule.db,
        context: seedA.context(),
        workOrderId: seedB.workOrderId,
        title: "Cross-org task",
      }),
    ).rejects.toMatchObject({ reason: "work_order_not_found" });

    const { taskId } = await addTask({
      db: dbModule.db,
      context: seedB.context(),
      workOrderId: seedB.workOrderId,
      title: "Own task",
    });
    await expect(
      updateTaskStatus({
        db: dbModule.db,
        context: seedA.context(),
        taskId,
        status: "DONE",
      }),
    ).rejects.toMatchObject({ reason: "task_not_found" });
  });
});
