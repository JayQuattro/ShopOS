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

async function seedPresentedRevision() {
  const orgId = randomUUID();
  const locationId = randomUUID();
  const userId = randomUUID();
  const membershipId = randomUUID();
  const roleId = randomUUID();
  const customerId = randomUUID();
  const assetId = randomUUID();

  await dbModule.db.$transaction([
    dbModule.db.organization.create({
      data: { id: orgId, slug: `org-${orgId.slice(0, 8)}`, name: "Auth Org" },
    }),
    dbModule.db.location.create({
      data: { id: locationId, organizationId: orgId, code: "MAIN", name: "Main", timeZone: "UTC" },
    }),
    dbModule.db.user.create({
      data: { id: userId, email: `u-${userId.slice(0, 8)}@example.test`, displayName: "Auth User" },
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
          "estimates.present",
          "authorizations.record",
        ],
      },
    }),
    dbModule.db.membershipRole.create({ data: { organizationId: orgId, membershipId, roleId } }),
    dbModule.db.customer.create({
      data: {
        id: customerId,
        organizationId: orgId,
        kind: "INDIVIDUAL",
        displayName: "Auth Customer",
      },
    }),
    dbModule.db.asset.create({
      data: {
        id: assetId,
        organizationId: orgId,
        customerId,
        displayName: "Auth Car",
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
      number: "RO-3001",
      customerConcern: "Test",
      status: "AWAITING_AUTHORIZATION",
    },
  });

  const revision = await dbModule.db.estimateRevision.create({
    data: {
      organizationId: orgId,
      locationId,
      workOrderId: wo.id,
      revisionNumber: 1,
      status: "PRESENTED",
      currency: "USD",
      subtotalMinor: 40000n,
      discountMinor: 0n,
      taxMinor: 2880n,
      totalMinor: 42880n,
      presentedAt: new Date(),
      createdByUserId: userId,
    },
  });

  const line1 = await dbModule.db.estimateLine.create({
    data: {
      organizationId: orgId,
      estimateRevisionId: revision.id,
      serviceGroupKey: "brakes",
      kind: "LABOR",
      description: "Replace brake pads",
      quantityMilli: 2500,
      unitPriceMinor: 16000n,
      grossMinor: 40000n,
      discountMinor: 0n,
      taxable: true,
      taxRateBasisPoints: 720,
      taxMinor: 2880n,
      totalMinor: 42880n,
      position: 1,
    },
  });

  return {
    orgId,
    revisionId: revision.id,
    lineId: line1.id,
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
          "authorizations.record",
        ] as const),
      }) as import("@/modules/tenancy/policy").TenantContext,
  };
}

describe("authorization service (#18)", { skip: shouldSkip }, () => {
  it("records an approval and transitions the work order to AUTHORIZED", async () => {
    const { recordAuthorization, getAuthorizationState } =
      await import("@/modules/estimates/authorization-service");
    const seed = await seedPresentedRevision();
    const context = seed.context();

    const result = await recordAuthorization({
      db: dbModule.db,
      context,
      revisionId: seed.revisionId,
      method: "IN_PERSON",
      providedByName: "John Customer",
      decisions: [{ estimateLineId: seed.lineId, decision: "APPROVED" }],
    });
    expect(result.authorizationId).toBeTruthy();

    const state = await getAuthorizationState({
      db: dbModule.db,
      context,
      revisionId: seed.revisionId,
    });
    expect(state.lines[0]?.decision).toBe("APPROVED");

    const wo = await dbModule.db.workOrder.findUnique({
      where: { id: seed.workOrderId },
      select: { status: true },
    });
    expect(wo?.status).toBe("AUTHORIZED");
  });

  it("records a decline without transitioning the work order to AUTHORIZED", async () => {
    const { recordAuthorization, getAuthorizationState } =
      await import("@/modules/estimates/authorization-service");
    const seed = await seedPresentedRevision();
    const context = seed.context();

    await recordAuthorization({
      db: dbModule.db,
      context,
      revisionId: seed.revisionId,
      method: "PHONE",
      providedByName: "Jane Customer",
      decisions: [{ estimateLineId: seed.lineId, decision: "DECLINED" }],
    });

    const state = await getAuthorizationState({
      db: dbModule.db,
      context,
      revisionId: seed.revisionId,
    });
    expect(state.lines[0]?.decision).toBe("DECLINED");

    // Work order should NOT be AUTHORIZED (no approvals).
    const wo = await dbModule.db.workOrder.findUnique({
      where: { id: seed.workOrderId },
      select: { status: true },
    });
    expect(wo?.status).not.toBe("AUTHORIZED");
  });

  it("prevents authorizing a DRAFT revision", async () => {
    const { recordAuthorization, AuthorizationFailed } =
      await import("@/modules/estimates/authorization-service");
    // Seed a DRAFT revision directly (never presented — the DB check constraint
    // prevents reverting PRESENTED → DRAFT, which is the immutability guarantee).
    const seed = await seedPresentedRevision();
    // Create a second DRAFT revision on the same work order.
    const { createDraftRevision, addLine } = await import("@/modules/estimates/estimate-service");
    const context = seed.context();
    const draftRev = await createDraftRevision({
      db: dbModule.db,
      context,
      workOrderId: (await dbModule.db.estimateRevision.findUnique({
        where: { id: seed.revisionId },
        select: { workOrderId: true },
      }))!.workOrderId,
      currency: "USD",
    });
    const draftLine = await addLine({
      db: dbModule.db,
      context,
      revisionId: draftRev.revisionId,
      kind: "FEE",
      serviceGroupKey: "test",
      description: "Draft line",
      quantityMilli: 1000,
      unitPriceMinor: 500,
      discountMinor: 0,
      taxable: false,
      taxRateBasisPoints: 0,
      position: 1,
    });

    await expect(
      recordAuthorization({
        db: dbModule.db,
        context,
        revisionId: draftRev.revisionId,
        method: "EMAIL",
        providedByName: "Test",
        decisions: [{ estimateLineId: draftLine.lineId, decision: "APPROVED" }],
      }),
    ).rejects.toMatchObject({ reason: "revision_not_presented" });
    expect(new AuthorizationFailed("revision_not_presented")).toBeInstanceOf(AuthorizationFailed);
  });

  it("prevents double-deciding the same line", async () => {
    const { recordAuthorization } = await import("@/modules/estimates/authorization-service");
    const seed = await seedPresentedRevision();
    const context = seed.context();

    // First decision.
    await recordAuthorization({
      db: dbModule.db,
      context,
      revisionId: seed.revisionId,
      method: "IN_PERSON",
      providedByName: "First",
      decisions: [{ estimateLineId: seed.lineId, decision: "APPROVED" }],
    });

    // Second decision on the same line.
    await expect(
      recordAuthorization({
        db: dbModule.db,
        context,
        revisionId: seed.revisionId,
        method: "IN_PERSON",
        providedByName: "Second",
        decisions: [{ estimateLineId: seed.lineId, decision: "DECLINED" }],
      }),
    ).rejects.toMatchObject({ reason: "already_decided" });
  });

  it("denies cross-org authorization", async () => {
    const { recordAuthorization } = await import("@/modules/estimates/authorization-service");
    const seedA = await seedPresentedRevision();
    const seedB = await seedPresentedRevision();
    const contextA = seedA.context();

    await expect(
      recordAuthorization({
        db: dbModule.db,
        context: contextA,
        revisionId: seedB.revisionId,
        method: "PHONE",
        providedByName: "Cross Org",
        decisions: [{ estimateLineId: seedB.lineId, decision: "APPROVED" }],
      }),
    ).rejects.toMatchObject({ reason: "revision_not_found" });
  });
});
