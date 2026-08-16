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
  const customerId = randomUUID();
  const assetId = randomUUID();

  await dbModule.db.$transaction([
    dbModule.db.organization.create({
      data: { id: orgId, slug: `al-${orgId.slice(0, 8)}`, name: "AL Org" },
    }),
    dbModule.db.location.create({
      data: { id: locationId, organizationId: orgId, code: "M", name: "Main", timeZone: "UTC" },
    }),
    dbModule.db.user.create({
      data: { id: userId, email: `al-${userId.slice(0, 8)}@e.test`, displayName: "AL User" },
    }),
    dbModule.db.organizationMembership.create({
      data: { id: randomUUID(), organizationId: orgId, userId },
    }),
    dbModule.db.customer.create({
      data: {
        id: customerId,
        organizationId: orgId,
        kind: "INDIVIDUAL",
        displayName: "AL Customer",
      },
    }),
    dbModule.db.asset.create({
      data: {
        id: assetId,
        organizationId: orgId,
        customerId,
        displayName: "AL Car",
        category: "automobile",
      },
    }),
  ]);

  const wo = await dbModule.db.workOrder.create({
    data: {
      id: randomUUID(),
      organizationId: orgId,
      locationId,
      customerId,
      assetId,
      number: "RO-7001",
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
      subtotalMinor: 20000n,
      discountMinor: 0n,
      taxMinor: 1440n,
      totalMinor: 21440n,
      presentedAt: new Date(),
      createdByUserId: userId,
    },
  });

  const line = await dbModule.db.estimateLine.create({
    data: {
      organizationId: orgId,
      estimateRevisionId: revision.id,
      serviceGroupKey: "t",
      kind: "LABOR",
      description: "Test labor",
      quantityMilli: 1000,
      unitPriceMinor: 20000n,
      grossMinor: 20000n,
      discountMinor: 0n,
      taxable: true,
      taxRateBasisPoints: 720,
      taxMinor: 1440n,
      totalMinor: 21440n,
      position: 1,
    },
  });

  return {
    orgId,
    revisionId: revision.id,
    lineId: line.id,
    workOrderId: wo.id,
    context: () =>
      ({
        actorId: userId,
        organizationId: orgId,
        membershipId: randomUUID(),
        requestId: randomUUID(),
        organizationWideLocationAccess: true,
        allowedLocationIds: new Set<string>(),
        permissions: new Set(["estimates.present", "work_orders.write"] as const),
      }) as import("@/modules/tenancy/policy").TenantContext,
  };
}

describe("authorization links", { skip: shouldSkip }, () => {
  it("creates, validates, and uses a link end-to-end", async () => {
    const { createAuthorizationLink, validateAuthorizationLink, markLinkUsed } =
      await import("@/modules/estimates/authorization-link-service");
    const seed = await seedPresentedRevision();
    const context = seed.context();

    const link = await createAuthorizationLink({
      db: dbModule.db,
      context,
      revisionId: seed.revisionId,
    });
    expect(link.token).toBeTruthy();
    expect(link.expiresAt.getTime()).toBeGreaterThan(Date.now());

    // Validate.
    const validated = await validateAuthorizationLink(dbModule.db, link.token);
    expect(validated.workOrderNumber).toBe("RO-7001");
    expect(validated.lines).toHaveLength(1);
    expect(validated.lines[0]?.description).toBe("Test labor");

    // Mark used.
    await markLinkUsed(dbModule.db, link.linkId);

    // Re-validate should fail (already used).
    await expect(validateAuthorizationLink(dbModule.db, link.token)).rejects.toMatchObject({
      reason: "link_used",
    });
  });

  it("rejects a link for a non-presented revision", async () => {
    const { createAuthorizationLink } =
      await import("@/modules/estimates/authorization-link-service");
    const seed = await seedPresentedRevision();

    // Flip to DRAFT.
    await dbModule.db.estimateRevision.update({
      where: { id: seed.revisionId },
      data: { status: "SUPERSEDED" },
    });

    await expect(
      createAuthorizationLink({
        db: dbModule.db,
        context: seed.context(),
        revisionId: seed.revisionId,
      }),
    ).rejects.toMatchObject({ reason: "revision_not_presented" });
  });

  it("revokes a link making it unusable", async () => {
    const { createAuthorizationLink, revokeAuthorizationLink, validateAuthorizationLink } =
      await import("@/modules/estimates/authorization-link-service");
    const seed = await seedPresentedRevision();
    const context = seed.context();

    const link = await createAuthorizationLink({
      db: dbModule.db,
      context,
      revisionId: seed.revisionId,
    });
    await revokeAuthorizationLink({ db: dbModule.db, context, linkId: link.linkId });

    await expect(validateAuthorizationLink(dbModule.db, link.token)).rejects.toMatchObject({
      reason: "link_revoked",
    });
  });

  it("rejects an expired link", async () => {
    const { createAuthorizationLink, validateAuthorizationLink } =
      await import("@/modules/estimates/authorization-link-service");
    const seed = await seedPresentedRevision();

    const link = await createAuthorizationLink({
      db: dbModule.db,
      context: seed.context(),
      revisionId: seed.revisionId,
    });

    // Manually expire the link.
    await dbModule.db.authorizationLink.update({
      where: { id: link.linkId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await expect(validateAuthorizationLink(dbModule.db, link.token)).rejects.toMatchObject({
      reason: "link_expired",
    });
  });

  it("rejects a cross-org link creation", async () => {
    const { createAuthorizationLink } =
      await import("@/modules/estimates/authorization-link-service");
    const seedA = await seedPresentedRevision();
    const seedB = await seedPresentedRevision();

    await expect(
      createAuthorizationLink({
        db: dbModule.db,
        context: seedA.context(),
        revisionId: seedB.revisionId,
      }),
    ).rejects.toMatchObject({ reason: "revision_not_found" });
  });
});
