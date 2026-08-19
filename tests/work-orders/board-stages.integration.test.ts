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
  const customerId = randomUUID();
  const workOrderId = randomUUID();

  await dbModule.db.$transaction([
    dbModule.db.organization.create({
      data: { id: orgId, slug: `org-${orgId.slice(0, 8)}`, name: "Stage Org" },
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
        email: `bs-${userId.slice(0, 8)}@example.test`,
        displayName: "Stage Manager",
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
        permissions: ["organizations.manage", "work_orders.write", "work_orders.read"],
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
        id: workOrderId,
        organizationId: orgId,
        locationId,
        customerId,
        number: "RO-BS1",
        customerConcern: "stage test",
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
        permissions ?? ["organizations.manage", "work_orders.write", "work_orders.read"],
      ),
    }) as import("@/modules/tenancy/policy").TenantContext;

  return { orgId, otherOrgId, workOrderId, context };
}

describe("custom board stages (#207)", { skip: shouldSkip }, () => {
  it("creates stages with derived keys, ordered, and deactivates with fallback", async () => {
    const stages = await import("@/modules/work-orders/board-stage-service");
    const seed = await seedShop();

    const first = await stages.createBoardStage({
      db: dbModule.db,
      context: seed.context(),
      label: "Waiting on customer",
    });
    const second = await stages.createBoardStage({
      db: dbModule.db,
      context: seed.context(),
      label: "Detail",
      colorHint: "#22d3ee",
    });

    const list = await stages.listBoardStages({ db: dbModule.db, context: seed.context() });
    expect(list.map((stage) => `${stage.key}:${stage.label}:${stage.sortOrder}`)).toEqual([
      "waiting-on-customer:Waiting on customer:1",
      "detail:Detail:2",
    ]);
    expect(list[1]?.colorHint).toBe("#22d3ee");
    void first;
    void second;

    // Deactivating clears work orders off the stage (fallback to built-in).
    await stages.setWorkOrderBoardStage({
      db: dbModule.db,
      context: seed.context(),
      workOrderId: seed.workOrderId,
      stageId: list[0]!.id,
    });
    expect(
      (await dbModule.db.workOrder.findUnique({ where: { id: seed.workOrderId } }))?.boardStageId,
    ).toBe(list[0]!.id);

    await stages.deactivateBoardStage({
      db: dbModule.db,
      context: seed.context(),
      stageId: list[0]!.id,
    });
    expect(
      (await dbModule.db.workOrder.findUnique({ where: { id: seed.workOrderId } }))?.boardStageId,
    ).toBeNull();
    expect(await stages.listBoardStages({ db: dbModule.db, context: seed.context() })).toHaveLength(
      1,
    );
  });

  it("moves work orders between custom stages and back to built-in", async () => {
    const stages = await import("@/modules/work-orders/board-stage-service");
    const seed = await seedShop();
    const { stageId } = await stages.createBoardStage({
      db: dbModule.db,
      context: seed.context(),
      label: "Sublet out",
    });

    await stages.setWorkOrderBoardStage({
      db: dbModule.db,
      context: seed.context(),
      workOrderId: seed.workOrderId,
      stageId,
    });
    expect(
      (await dbModule.db.workOrder.findUnique({ where: { id: seed.workOrderId } }))?.boardStageId,
    ).toBe(stageId);

    // Clearing returns to the built-in stage.
    await stages.setWorkOrderBoardStage({
      db: dbModule.db,
      context: seed.context(),
      workOrderId: seed.workOrderId,
      stageId: null,
    });
    expect(
      (await dbModule.db.workOrder.findUnique({ where: { id: seed.workOrderId } }))?.boardStageId,
    ).toBeNull();
  });

  it("scopes stages and assignments per organization and validates keys", async () => {
    const stages = await import("@/modules/work-orders/board-stage-service");
    const { TenantAccessDenied } = await import("@/modules/tenancy/policy");
    const seed = await seedShop();
    const foreignContext = {
      ...seed.context(),
      organizationId: seed.otherOrgId,
    } as import("@/modules/tenancy/policy").TenantContext;

    // Duplicate keys are per-org.
    await stages.createBoardStage({ db: dbModule.db, context: seed.context(), label: "Detail" });
    await expect(
      stages.createBoardStage({ db: dbModule.db, context: seed.context(), label: "Detail" }),
    ).rejects.toMatchObject({ reason: "duplicate_key" });
    // The same key in another org is fine.
    await stages.createBoardStage({ db: dbModule.db, context: foreignContext, label: "Detail" });

    // Foreign stages cannot be assigned; foreign WOs cannot be staged.
    const foreignStage = await dbModule.db.boardStage.findFirst({
      where: { organizationId: seed.otherOrgId },
      select: { id: true },
    });
    await expect(
      stages.setWorkOrderBoardStage({
        db: dbModule.db,
        context: seed.context(),
        workOrderId: seed.workOrderId,
        stageId: foreignStage!.id,
      }),
    ).rejects.toMatchObject({ reason: "stage_not_found" });
    await expect(
      stages.setWorkOrderBoardStage({
        db: dbModule.db,
        context: foreignContext,
        workOrderId: seed.workOrderId,
        stageId: null,
      }),
    ).rejects.toMatchObject({ reason: "work_order_not_found" });

    // Key shape validation and write permission.
    await expect(
      stages.createBoardStage({
        db: dbModule.db,
        context: seed.context(),
        label: "OK",
        key: "BAD KEY!",
      }),
    ).rejects.toMatchObject({ reason: "invalid_key" });
    await expect(
      stages.createBoardStage({
        db: dbModule.db,
        context: seed.context(["work_orders.write"]),
        label: "Nope",
      }),
    ).rejects.toThrowError(TenantAccessDenied);
  });
});
