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

async function seedWorkOrder() {
  const orgId = randomUUID();
  const locationId = randomUUID();
  const userId = randomUUID();
  const membershipId = randomUUID();
  const roleId = randomUUID();
  const customerId = randomUUID();
  const assetId = randomUUID();

  await dbModule.db.$transaction([
    dbModule.db.organization.create({
      data: { id: orgId, slug: `org-${orgId.slice(0, 8)}`, name: "Est Org" },
    }),
    dbModule.db.location.create({
      data: { id: locationId, organizationId: orgId, code: "MAIN", name: "Main", timeZone: "UTC" },
    }),
    dbModule.db.user.create({
      data: { id: userId, email: `u-${userId.slice(0, 8)}@example.test`, displayName: "Est User" },
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
        displayName: "Est Customer",
      },
    }),
    dbModule.db.asset.create({
      data: {
        id: assetId,
        organizationId: orgId,
        customerId,
        displayName: "Est Car",
        category: "automobile",
      },
    }),
  ]);

  const wo = await dbModule.db.workOrder.create({
    data: {
      organizationId: orgId,
      locationId,
      customerId,
      assetId,
      number: "RO-2001",
      customerConcern: "Test concern",
    },
  });

  return {
    orgId,
    locationId,
    workOrderId: wo.id,
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

describe("estimate revisions (#17)", { skip: shouldSkip }, () => {
  it("creates a draft revision, adds lines, and presents it", async () => {
    const { createDraftRevision, addLine, presentRevision } =
      await import("@/modules/estimates/estimate-service");
    const seed = await seedWorkOrder();
    const context = seed.context();

    const rev = await createDraftRevision({
      db: dbModule.db,
      context,
      workOrderId: seed.workOrderId,
      currency: "USD",
    });
    expect(rev.revisionNumber).toBe(1);

    await addLine({
      db: dbModule.db,
      context,
      revisionId: rev.revisionId,
      kind: "LABOR",
      serviceGroupKey: "brakes",
      description: "Replace front brake pads",
      quantityMilli: 2500,
      unitPriceMinor: 16000,
      discountMinor: 0,
      taxable: true,
      taxRateBasisPoints: 720,
      position: 1,
    });
    await addLine({
      db: dbModule.db,
      context,
      revisionId: rev.revisionId,
      kind: "PART",
      serviceGroupKey: "brakes",
      description: "Brake pad set",
      quantityMilli: 1000,
      unitPriceMinor: 25000,
      discountMinor: 0,
      taxable: true,
      taxRateBasisPoints: 720,
      position: 2,
    });

    // Present the revision.
    await presentRevision({ db: dbModule.db, context, revisionId: rev.revisionId });

    const revision = await dbModule.db.estimateRevision.findUnique({
      where: { id: rev.revisionId },
      select: { status: true, subtotalMinor: true, totalMinor: true },
    });
    expect(revision?.status).toBe("PRESENTED");
    expect(Number(revision?.subtotalMinor)).toBeGreaterThan(0);
    expect(Number(revision?.totalMinor)).toBeGreaterThan(0);
  });

  it("prevents adding lines to a presented revision (immutability)", async () => {
    const { createDraftRevision, addLine, presentRevision, EstimateFailed } =
      await import("@/modules/estimates/estimate-service");
    const seed = await seedWorkOrder();
    const context = seed.context();

    const rev = await createDraftRevision({
      db: dbModule.db,
      context,
      workOrderId: seed.workOrderId,
      currency: "USD",
    });
    await addLine({
      db: dbModule.db,
      context,
      revisionId: rev.revisionId,
      kind: "FEE",
      serviceGroupKey: "shop",
      description: "Shop supply fee",
      quantityMilli: 1000,
      unitPriceMinor: 500,
      discountMinor: 0,
      taxable: false,
      taxRateBasisPoints: 0,
      position: 1,
    });
    await presentRevision({ db: dbModule.db, context, revisionId: rev.revisionId });

    await expect(
      addLine({
        db: dbModule.db,
        context,
        revisionId: rev.revisionId,
        kind: "LABOR",
        serviceGroupKey: "extra",
        description: "Should fail",
        quantityMilli: 1000,
        unitPriceMinor: 1000,
        discountMinor: 0,
        taxable: false,
        taxRateBasisPoints: 0,
        position: 2,
      }),
    ).rejects.toMatchObject({ reason: "revision_not_draft" });
    expect(new EstimateFailed("revision_not_draft")).toBeInstanceOf(EstimateFailed);
  });

  it("supersedes a presented revision with a new draft", async () => {
    const { createDraftRevision, addLine, presentRevision, supersedeRevision } =
      await import("@/modules/estimates/estimate-service");
    const seed = await seedWorkOrder();
    const context = seed.context();

    const rev1 = await createDraftRevision({
      db: dbModule.db,
      context,
      workOrderId: seed.workOrderId,
      currency: "USD",
    });
    await addLine({
      db: dbModule.db,
      context,
      revisionId: rev1.revisionId,
      kind: "LABOR",
      serviceGroupKey: "test",
      description: "Initial",
      quantityMilli: 1000,
      unitPriceMinor: 1000,
      discountMinor: 0,
      taxable: false,
      taxRateBasisPoints: 0,
      position: 1,
    });
    await presentRevision({ db: dbModule.db, context, revisionId: rev1.revisionId });

    const rev2 = await supersedeRevision({ db: dbModule.db, context, revisionId: rev1.revisionId });
    expect(rev2.newRevisionNumber).toBe(2);

    const oldRev = await dbModule.db.estimateRevision.findUnique({
      where: { id: rev1.revisionId },
      select: { status: true },
    });
    expect(oldRev?.status).toBe("SUPERSEDED");

    const newRev = await dbModule.db.estimateRevision.findUnique({
      where: { id: rev2.newRevisionId },
      select: { status: true, revisionNumber: true, supersedesRevisionId: true },
    });
    expect(newRev?.status).toBe("DRAFT");
    expect(newRev?.supersedesRevisionId).toBe(rev1.revisionId);
  });

  it("denies operations on cross-org revisions", async () => {
    const { createDraftRevision } = await import("@/modules/estimates/estimate-service");
    const seedA = await seedWorkOrder();
    const seedB = await seedWorkOrder();
    const contextA = seedA.context();

    // Try to create a revision for org B's work order using org A's context.
    await expect(
      createDraftRevision({
        db: dbModule.db,
        context: contextA,
        workOrderId: seedB.workOrderId,
        currency: "USD",
      }),
    ).rejects.toMatchObject({ reason: "work_order_not_found" });
  });
});
