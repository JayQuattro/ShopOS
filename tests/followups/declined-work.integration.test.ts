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

async function seedWithDeclinedLine(workOrderStatus: "IN_PROGRESS" | "CLOSED") {
  const orgId = randomUUID();
  const otherOrgId = randomUUID();
  const locationId = randomUUID();
  const userId = randomUUID();
  const membershipId = randomUUID();
  const roleId = randomUUID();
  const customerId = randomUUID();
  const assetId = randomUUID();

  await dbModule.db.$transaction([
    dbModule.db.organization.create({
      data: { id: orgId, slug: `org-${orgId.slice(0, 8)}`, name: "FollowUp Org" },
    }),
    dbModule.db.organization.create({
      data: { id: otherOrgId, slug: `org-${otherOrgId.slice(0, 8)}`, name: "Other Org" },
    }),
    dbModule.db.location.create({
      data: { id: locationId, organizationId: orgId, code: "MAIN", name: "Main", timeZone: "UTC" },
    }),
    dbModule.db.user.create({
      data: {
        id: userId,
        email: `f-${userId.slice(0, 8)}@example.test`,
        displayName: "Follow User",
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
        displayName: "Follow Customer",
      },
    }),
    dbModule.db.asset.create({
      data: {
        id: assetId,
        organizationId: orgId,
        customerId,
        displayName: "Follow Car",
        category: "automobile",
      },
    }),
    dbModule.db.workOrder.create({
      data: {
        organizationId: orgId,
        locationId,
        customerId,
        assetId,
        number: "RO-1401",
        customerConcern: "Follow up",
        status: workOrderStatus,
      },
    }),
  ]);

  const workOrderId = (await dbModule.db.workOrder.findFirst({ where: { organizationId: orgId } }))!
    .id;

  const revision = await dbModule.db.estimateRevision.create({
    data: {
      organizationId: orgId,
      locationId,
      workOrderId,
      revisionNumber: 1,
      status: "PRESENTED",
      documentKind: "BASELINE",
      currency: "USD",
      subtotalMinor: 20000n,
      discountMinor: 0n,
      taxMinor: 0n,
      totalMinor: 20000n,
      presentedAt: new Date(),
    },
  });
  const approvedLine = await dbModule.db.estimateLine.create({
    data: {
      organizationId: orgId,
      estimateRevisionId: revision.id,
      serviceGroupKey: "brakes",
      kind: "LABOR",
      description: "Approved brake work",
      quantityMilli: 1000,
      unitPriceMinor: 12000n,
      grossMinor: 12000n,
      discountMinor: 0n,
      taxable: false,
      taxRateBasisPoints: 0,
      taxMinor: 0n,
      totalMinor: 12000n,
      position: 1,
    },
  });
  const declinedLine = await dbModule.db.estimateLine.create({
    data: {
      organizationId: orgId,
      estimateRevisionId: revision.id,
      serviceGroupKey: "tires",
      kind: "PART",
      description: "Alignment",
      quantityMilli: 1000,
      unitPriceMinor: 8000n,
      grossMinor: 8000n,
      discountMinor: 0n,
      taxable: false,
      taxRateBasisPoints: 0,
      taxMinor: 0n,
      totalMinor: 8000n,
      position: 2,
    },
  });
  const authorization = await dbModule.db.authorization.create({
    data: {
      organizationId: orgId,
      estimateRevisionId: revision.id,
      method: "CUSTOMER_LINK",
      providedByName: "Follow Customer",
      occurredAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
    },
  });
  await dbModule.db.authorizationDecision.createMany({
    data: [
      {
        authorizationId: authorization.id,
        organizationId: orgId,
        estimateLineId: approvedLine.id,
        decision: "APPROVED",
      },
      {
        authorizationId: authorization.id,
        organizationId: orgId,
        estimateLineId: declinedLine.id,
        decision: "DECLINED",
      },
    ],
  });

  return {
    orgId,
    otherOrgId,
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

describe("declined work follow-up (#152)", { skip: shouldSkip }, () => {
  it("lists declined lines on open jobs with customer and job context", async () => {
    const { listDeclinedWork } = await import("@/modules/followups/declined-work-service");
    const seedData = await seedWithDeclinedLine("IN_PROGRESS");

    const items = await listDeclinedWork({ db: dbModule.db, context: seedData.context() });
    expect(items).toHaveLength(1);
    expect(items[0]?.description).toBe("Alignment");
    expect(items[0]?.amountMinor).toBe("8000");
    expect(items[0]?.customerName).toBe("Follow Customer");
    expect(items[0]?.assetName).toBe("Follow Car");
    expect(items[0]?.workOrderNumber).toBe("RO-1401");
  });

  it("excludes declined work on closed jobs", async () => {
    const { listDeclinedWork } = await import("@/modules/followups/declined-work-service");
    const seedData = await seedWithDeclinedLine("CLOSED");

    const items = await listDeclinedWork({ db: dbModule.db, context: seedData.context() });
    expect(items).toHaveLength(0);
  });

  it("re-quotes a declined line into a draft change order at its original price", async () => {
    const { listDeclinedWork, reQuoteDeclinedLine } =
      await import("@/modules/followups/declined-work-service");
    const seedData = await seedWithDeclinedLine("IN_PROGRESS");

    // Give the WO an approved baseline so change orders are allowed (the seed
    // already records an APPROVED decision on the approved line, satisfying
    // the baseline-approval gate).
    const items = await listDeclinedWork({ db: dbModule.db, context: seedData.context() });
    expect(items).toHaveLength(1);

    const result = await reQuoteDeclinedLine({
      db: dbModule.db,
      context: seedData.context(),
      decisionId: items[0]!.decisionId,
    });
    expect(result.changeOrderNumber).toBe(1);
    expect(result.presented).toBe(false);

    const revision = await dbModule.db.estimateRevision.findUnique({
      where: { id: result.revisionId },
      include: { lines: true },
    });
    expect(revision?.documentKind).toBe("CHANGE_ORDER");
    expect(revision?.status).toBe("DRAFT");
    expect(revision?.lines).toHaveLength(1);
    expect(revision?.lines[0]?.description).toBe("Alignment");
    expect(revision?.lines[0]?.unitPriceMinor).toBe(8000n);
    expect(revision?.lines[0]?.totalMinor).toBe(8000n);

    // The presented variant flows through the standard change-order lifecycle.
    const second = await seedWithDeclinedLine("IN_PROGRESS");
    const items2 = await listDeclinedWork({ db: dbModule.db, context: second.context() });
    const presentedResult = await reQuoteDeclinedLine({
      db: dbModule.db,
      context: second.context(),
      decisionId: items2[0]!.decisionId,
      present: true,
    });
    expect(presentedResult.presented).toBe(true);
    const presentedRevision = await dbModule.db.estimateRevision.findUnique({
      where: { id: presentedResult.revisionId },
    });
    expect(presentedRevision?.status).toBe("PRESENTED");
  });

  it("refuses re-quotes on foreign decisions", async () => {
    const { listDeclinedWork, reQuoteDeclinedLine } =
      await import("@/modules/followups/declined-work-service");
    const seedA = await seedWithDeclinedLine("IN_PROGRESS");
    const seedB = await seedWithDeclinedLine("IN_PROGRESS");
    const itemsB = await listDeclinedWork({ db: dbModule.db, context: seedB.context() });

    await expect(
      reQuoteDeclinedLine({
        db: dbModule.db,
        context: seedA.context(),
        decisionId: itemsB[0]!.decisionId,
      }),
    ).rejects.toMatchObject({ reason: "decision_not_found" });
    void seedA;
  });

  it("stays tenant-scoped", async () => {
    const { listDeclinedWork } = await import("@/modules/followups/declined-work-service");
    const seedA = await seedWithDeclinedLine("IN_PROGRESS");
    const otherUser = randomUUID();
    const otherMembership = randomUUID();
    await dbModule.db.user.create({
      data: {
        id: otherUser,
        email: `o-${otherUser.slice(0, 8)}@example.test`,
        displayName: "Outsider",
      },
    });
    await dbModule.db.organizationMembership.create({
      data: {
        id: otherMembership,
        organizationId: seedA.otherOrgId,
        userId: otherUser,
        organizationWideLocationAccess: true,
      },
    });
    const otherContext = {
      ...seedA.context(),
      organizationId: seedA.otherOrgId,
      membershipId: otherMembership,
    };

    const items = await listDeclinedWork({ db: dbModule.db, context: otherContext });
    expect(items).toHaveLength(0);
  });
});
