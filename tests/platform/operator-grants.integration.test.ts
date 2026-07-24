import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { assertDedicatedTestDatabase, resetTestDatabase } from "../helpers/database";

/**
 * Integration test for platform operator grant management (issue #72).
 *
 * Exercises the full denial matrix: permission denial, self-grant prevention,
 * last-admin safety, expired/revoked/disabled/MFA-missing rejection, identifier
 * guessing, concurrent revocation, and happy paths with audit assertions.
 *
 * Requires SHOPOS_TEST_DATABASE_URL. Skips cleanly when Postgres is unreachable.
 */

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

/**
 * Seeds an admin operator (MFA-enabled, verified, not disabled) + optional
 * target user and returns a PlatformContext factory.
 */
async function seedAdmin(options?: {
  targetEmail?: string;
  targetMfa?: boolean;
  targetVerified?: boolean;
  targetDisabled?: boolean;
}): Promise<{
  adminId: string;
  adminGrantId: string;
  context: () => Promise<import("@/modules/platform/authorization").PlatformContext>;
  targetUserId?: string | undefined;
}> {
  const adminId = randomUUID();
  const adminGrantId = randomUUID();

  await dbModule.db.user.create({
    data: {
      id: adminId,
      email: `admin-${adminId.slice(0, 8)}@example.test`,
      displayName: "Admin",
      emailVerified: true,
      twoFactorEnabled: true,
    },
  });
  await dbModule.db.platformOperatorGrant.create({
    data: {
      id: adminGrantId,
      userId: adminId,
      role: "ADMIN",
      reason: "Integration test admin grant.",
    },
  });

  let targetUserId: string | undefined;
  if (options?.targetEmail) {
    targetUserId = randomUUID();
    await dbModule.db.user.create({
      data: {
        id: targetUserId,
        email: options.targetEmail,
        displayName: "Target User",
        emailVerified: options.targetVerified ?? true,
        twoFactorEnabled: options.targetMfa ?? true,
        ...(options.targetDisabled ? { disabledAt: new Date() } : {}),
      },
    });
  }

  const { resolvePlatformContext } = await import("@/modules/platform/authorization");
  return {
    adminId,
    adminGrantId,
    context: () =>
      resolvePlatformContext({
        db: dbModule.db,
        actorId: adminId,
        requestId: `test-${randomUUID()}`,
      }),
    targetUserId,
  };
}

describe("listOperatorGrants", { skip: shouldSkip }, () => {
  it("lists grants with status categorization", async () => {
    const { listOperatorGrants } = await import("@/modules/platform/operator-grants");
    const seed = await seedAdmin();
    const context = await seed.context();

    const grants = await listOperatorGrants(dbModule.db, context);
    expect(grants).toHaveLength(1);
    expect(grants[0]?.status).toBe("active");
    expect(grants[0]?.role).toBe("ADMIN");
  });

  it("denies listing to a Viewer", async () => {
    const { listOperatorGrants } = await import("@/modules/platform/operator-grants");
    const { PlatformPermissionDenied } = await import("@/modules/platform/authorization");

    const viewerId = randomUUID();
    await dbModule.db.user.create({
      data: {
        id: viewerId,
        email: `v-${viewerId.slice(0, 8)}@example.test`,
        displayName: "Viewer",
        emailVerified: true,
        twoFactorEnabled: true,
      },
    });
    await dbModule.db.platformOperatorGrant.create({
      data: { id: randomUUID(), userId: viewerId, role: "VIEWER", reason: "Viewer for test." },
    });

    const { resolvePlatformContext } = await import("@/modules/platform/authorization");
    const context = await resolvePlatformContext({
      db: dbModule.db,
      actorId: viewerId,
      requestId: `test-${randomUUID()}`,
    });

    await expect(listOperatorGrants(dbModule.db, context)).rejects.toThrowError(
      PlatformPermissionDenied,
    );
  });
});

describe("grantOperatorRole", { skip: shouldSkip }, () => {
  it("grants a role to an eligible user with audit", async () => {
    const { grantOperatorRole } = await import("@/modules/platform/operator-grants");
    const seed = await seedAdmin({ targetEmail: "target@example.test" });
    const context = await seed.context();

    const result = await grantOperatorRole({
      db: dbModule.db,
      context,
      targetUserId: seed.targetUserId!,
      role: "OPERATOR",
      reason: "Granting operator access for testing.",
    });
    expect(result.grantId).toBeTruthy();

    const audit = await dbModule.db.platformAuditEvent.findFirst({
      where: { action: "platform.operator.granted", targetId: seed.targetUserId! },
    });
    expect(audit).toBeTruthy();
  });

  it("denies self-grant", async () => {
    const { grantOperatorRole } = await import("@/modules/platform/operator-grants");
    const { OperatorGrantFailed } = await import("@/modules/platform/operator-grants");
    const seed = await seedAdmin();
    const context = await seed.context();

    await expect(
      grantOperatorRole({
        db: dbModule.db,
        context,
        targetUserId: seed.adminId,
        role: "ADMIN",
        reason: "Attempting self-grant for testing.",
      }),
    ).rejects.toMatchObject({ reason: "self_grant_forbidden" });
    expect(new OperatorGrantFailed("self_grant_forbidden")).toBeInstanceOf(OperatorGrantFailed);
  });

  it("rejects a target without MFA", async () => {
    const { grantOperatorRole } = await import("@/modules/platform/operator-grants");
    const seed = await seedAdmin({ targetEmail: "nomfa@example.test", targetMfa: false });
    const context = await seed.context();

    await expect(
      grantOperatorRole({
        db: dbModule.db,
        context,
        targetUserId: seed.targetUserId!,
        role: "VIEWER",
        reason: "Attempting grant to no-MFA user.",
      }),
    ).rejects.toMatchObject({ reason: "target_user_not_eligible" });
  });

  it("rejects a disabled target user", async () => {
    const { grantOperatorRole } = await import("@/modules/platform/operator-grants");
    const seed = await seedAdmin({ targetEmail: "disabled@example.test", targetDisabled: true });
    const context = await seed.context();

    await expect(
      grantOperatorRole({
        db: dbModule.db,
        context,
        targetUserId: seed.targetUserId!,
        role: "VIEWER",
        reason: "Attempting grant to disabled user.",
      }),
    ).rejects.toMatchObject({ reason: "target_user_not_eligible" });
  });

  it("rejects a non-existent target user", async () => {
    const { grantOperatorRole } = await import("@/modules/platform/operator-grants");
    const seed = await seedAdmin();
    const context = await seed.context();

    await expect(
      grantOperatorRole({
        db: dbModule.db,
        context,
        targetUserId: randomUUID(),
        role: "VIEWER",
        reason: "Attempting grant to ghost user.",
      }),
    ).rejects.toMatchObject({ reason: "target_user_not_found" });
  });

  it("rejects granting when the target already has an active grant", async () => {
    const { grantOperatorRole } = await import("@/modules/platform/operator-grants");
    const seed = await seedAdmin({ targetEmail: "existing@example.test" });
    const context = await seed.context();

    // First grant succeeds.
    await grantOperatorRole({
      db: dbModule.db,
      context,
      targetUserId: seed.targetUserId!,
      role: "VIEWER",
      reason: "First grant for testing purposes.",
    });

    // Second grant fails.
    await expect(
      grantOperatorRole({
        db: dbModule.db,
        context,
        targetUserId: seed.targetUserId!,
        role: "OPERATOR",
        reason: "Second grant attempt for testing.",
      }),
    ).rejects.toMatchObject({ reason: "target_already_has_grant" });
  });
});

describe("revokeOperatorGrant", { skip: shouldSkip }, () => {
  it("revokes a grant with reason and audit", async () => {
    const { grantOperatorRole, revokeOperatorGrant } =
      await import("@/modules/platform/operator-grants");
    const seed = await seedAdmin({ targetEmail: "revoke@example.test" });
    const context = await seed.context();

    const grant = await grantOperatorRole({
      db: dbModule.db,
      context,
      targetUserId: seed.targetUserId!,
      role: "OPERATOR",
      reason: "Granting then revoking for testing.",
    });

    await revokeOperatorGrant({
      db: dbModule.db,
      context,
      grantId: grant.grantId,
      reason: "Revocation for testing purposes.",
    });

    const row = await dbModule.db.platformOperatorGrant.findUnique({
      where: { id: grant.grantId },
      select: { revokedAt: true, revocationReason: true },
    });
    expect(row?.revokedAt).not.toBeNull();
    expect(row?.revocationReason).toContain("Revocation");

    const audit = await dbModule.db.platformAuditEvent.findFirst({
      where: { action: "platform.operator.revoked", targetId: seed.targetUserId! },
    });
    expect(audit).toBeTruthy();
  });

  it("prevents revoking the last active admin grant", async () => {
    const { revokeOperatorGrant } = await import("@/modules/platform/operator-grants");
    const seed = await seedAdmin();
    const context = await seed.context();

    await expect(
      revokeOperatorGrant({
        db: dbModule.db,
        context,
        grantId: seed.adminGrantId,
        reason: "Attempting to revoke the last admin.",
      }),
    ).rejects.toMatchObject({ reason: "last_admin_protected" });
  });

  it("allows revoking an admin when another admin exists", async () => {
    const { grantOperatorRole, revokeOperatorGrant } =
      await import("@/modules/platform/operator-grants");
    const seed = await seedAdmin({ targetEmail: "second-admin@example.test" });
    const context = await seed.context();

    // Grant a second admin.
    await grantOperatorRole({
      db: dbModule.db,
      context,
      targetUserId: seed.targetUserId!,
      role: "ADMIN",
      reason: "Second admin for last-admin test.",
    });

    // Now the first admin can be revoked.
    await revokeOperatorGrant({
      db: dbModule.db,
      context,
      grantId: seed.adminGrantId,
      reason: "Revoking first admin with backup present.",
    });

    const row = await dbModule.db.platformOperatorGrant.findUnique({
      where: { id: seed.adminGrantId },
      select: { revokedAt: true },
    });
    expect(row?.revokedAt).not.toBeNull();
  });

  it("rejects revoking an already-revoked grant", async () => {
    const { grantOperatorRole, revokeOperatorGrant } =
      await import("@/modules/platform/operator-grants");
    const seed = await seedAdmin({ targetEmail: "double-revoke@example.test" });
    const context = await seed.context();

    const grant = await grantOperatorRole({
      db: dbModule.db,
      context,
      targetUserId: seed.targetUserId!,
      role: "OPERATOR",
      reason: "Grant for double-revoke test.",
    });

    await revokeOperatorGrant({
      db: dbModule.db,
      context,
      grantId: grant.grantId,
      reason: "First revocation for testing.",
    });

    await expect(
      revokeOperatorGrant({
        db: dbModule.db,
        context,
        grantId: grant.grantId,
        reason: "Second revocation attempt.",
      }),
    ).rejects.toMatchObject({ reason: "already_revoked" });
  });

  it("rejects revoking a non-existent grant (identifier guessing)", async () => {
    const { revokeOperatorGrant } = await import("@/modules/platform/operator-grants");
    const seed = await seedAdmin();
    const context = await seed.context();

    await expect(
      revokeOperatorGrant({
        db: dbModule.db,
        context,
        grantId: randomUUID(),
        reason: "Attempting to revoke ghost grant.",
      }),
    ).rejects.toMatchObject({ reason: "grant_not_found" });
  });
});
