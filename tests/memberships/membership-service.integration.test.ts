import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { assertDedicatedTestDatabase, resetTestDatabase } from "../helpers/database";

/**
 * Integration test for the membership, role, location-access, and invitation
 * services against a throwaway PostgreSQL database.
 *
 * Exercises the adversarial matrix required by AGENTS.md and issue #8:
 * cross-organization denial, privilege escalation, last-owner safety,
 * unauthorized mutation, scoped location grants, and invitation lifecycle.
 *
 * Requires SHOPOS_TEST_DATABASE_URL (defaults to the compose `shopos_test`
 * database). Skips cleanly when Postgres is unreachable.
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

const ALL_PERMISSIONS = [
  "organizations.manage",
  "memberships.manage",
  "customers.read",
  "customers.write",
  "assets.read",
  "assets.write",
  "work_orders.read",
  "work_orders.write",
  "estimates.present",
  "authorizations.record",
  "invoices.issue",
  "payments.record",
] as const;

const MANAGER_PERMISSIONS = ALL_PERMISSIONS.filter((p) => p !== "organizations.manage");

/**
 * Seeds a full organization: org, location, all six built-in roles, an owner
 * membership, and an optional second membership. Returns IDs + a TenantContext
 * factory so each test can build contexts with chosen permissions.
 */
async function seedOrganization(options?: {
  secondUserEmail?: string;
  secondRoleKey?: string;
}): Promise<{
  orgId: string;
  locationId: string;
  ownerId: string;
  ownerMembershipId: string;
  secondUserId?: string | undefined;
  secondMembershipId?: string | undefined;
  roleId: (key: string) => string;
  makeContext: (overrides?: {
    actorId?: string;
    permissions?: readonly string[];
    membershipId?: string;
  }) => import("@/modules/tenancy/policy").TenantContext;
}> {
  const orgId = randomUUID();
  const locationId = randomUUID();
  const ownerId = randomUUID();
  const ownerMembershipId = randomUUID();
  const roleIds = new Map<string, string>();

  await dbModule.db.$transaction([
    dbModule.db.organization.create({
      data: { id: orgId, slug: `org-${orgId.slice(0, 8)}`, name: "Test Org" },
    }),
    dbModule.db.location.create({
      data: { id: locationId, organizationId: orgId, code: "MAIN", name: "Main", timeZone: "UTC" },
    }),
    ...(["owner", "manager", "advisor", "technician", "parts", "administrator"] as const).map(
      (key) => {
        const roleId = randomUUID();
        roleIds.set(key, roleId);
        return dbModule.db.role.create({
          data: {
            id: roleId,
            organizationId: orgId,
            key,
            name: key,
            permissions:
              key === "owner" || key === "administrator"
                ? [...ALL_PERMISSIONS]
                : key === "manager"
                  ? [...MANAGER_PERMISSIONS]
                  : key === "advisor"
                    ? MANAGER_PERMISSIONS.filter((p) => p !== "memberships.manage")
                    : ["customers.read", "assets.read", "work_orders.read", "work_orders.write"],
          },
        });
      },
    ),
    dbModule.db.user.create({
      data: {
        id: ownerId,
        email: `owner-${ownerId.slice(0, 8)}@example.test`,
        displayName: "Owner",
        emailVerified: true,
      },
    }),
    dbModule.db.organizationMembership.create({
      data: {
        id: ownerMembershipId,
        organizationId: orgId,
        userId: ownerId,
        authRole: "owner",
        organizationWideLocationAccess: true,
      },
    }),
    dbModule.db.membershipRole.create({
      data: {
        organizationId: orgId,
        membershipId: ownerMembershipId,
        roleId: roleIds.get("owner")!,
      },
    }),
  ]);

  let secondUserId: string | undefined;
  let secondMembershipId: string | undefined;
  if (options?.secondUserEmail) {
    secondUserId = randomUUID();
    secondMembershipId = randomUUID();
    const roleKey = options.secondRoleKey ?? "advisor";
    await dbModule.db.$transaction([
      dbModule.db.user.create({
        data: {
          id: secondUserId,
          email: options.secondUserEmail,
          displayName: "Second",
          emailVerified: true,
        },
      }),
      dbModule.db.organizationMembership.create({
        data: {
          id: secondMembershipId,
          organizationId: orgId,
          userId: secondUserId,
          authRole: roleKey,
          organizationWideLocationAccess: false,
        },
      }),
      dbModule.db.membershipRole.create({
        data: {
          organizationId: orgId,
          membershipId: secondMembershipId,
          roleId: roleIds.get(roleKey)!,
        },
      }),
    ]);
  }

  return {
    orgId,
    locationId,
    ownerId,
    ownerMembershipId,
    secondUserId,
    secondMembershipId,
    roleId: (key: string) => roleIds.get(key)!,
    makeContext: (overrides) =>
      ({
        actorId: overrides?.actorId ?? ownerId,
        organizationId: orgId,
        membershipId: overrides?.membershipId ?? ownerMembershipId,
        requestId: randomUUID(),
        organizationWideLocationAccess: true,
        allowedLocationIds: new Set<string>(),
        permissions: new Set(overrides?.permissions ?? [...ALL_PERMISSIONS]),
      }) as import("@/modules/tenancy/policy").TenantContext,
  };
}

describe("membership service — role assignment", { skip: shouldSkip }, () => {
  it("assigns a built-in role to a membership within the actor's privilege", async () => {
    const { assignRole } = await import("@/modules/memberships/membership-service");
    const seed = await seedOrganization({ secondUserEmail: "member@example.test" });
    const context = seed.makeContext();

    await assignRole({
      db: dbModule.db,
      context,
      membershipId: seed.secondMembershipId!,
      roleKey: "technician",
    });

    const membership = await dbModule.db.organizationMembership.findFirst({
      where: { id: seed.secondMembershipId! },
      include: { roles: { include: { role: { select: { key: true } } } } },
    });
    expect(membership?.roles.map((r: { role: { key: string } }) => r.role.key)).toContain(
      "technician",
    );
  });

  it("denies a manager from assigning the owner role (privilege escalation)", async () => {
    const { assignRole } = await import("@/modules/memberships/membership-service");
    const { RoleEscalationDenied } = await import("@/modules/memberships/role-policy");
    const seed = await seedOrganization({ secondUserEmail: "member@example.test" });
    const managerContext = seed.makeContext({ permissions: [...MANAGER_PERMISSIONS] });

    await expect(
      assignRole({
        db: dbModule.db,
        context: managerContext,
        membershipId: seed.secondMembershipId!,
        roleKey: "owner",
      }),
    ).rejects.toThrowError(RoleEscalationDenied);
  });

  it("denies an actor without memberships.manage from assigning any role", async () => {
    const { assignRole } = await import("@/modules/memberships/membership-service");
    const { TenantAccessDenied } = await import("@/modules/tenancy/policy");
    const seed = await seedOrganization({ secondUserEmail: "member@example.test" });
    const noManageContext = seed.makeContext({
      permissions: MANAGER_PERMISSIONS.filter((p) => p !== "memberships.manage"),
    });

    await expect(
      assignRole({
        db: dbModule.db,
        context: noManageContext,
        membershipId: seed.secondMembershipId!,
        roleKey: "technician",
      }),
    ).rejects.toThrowError(TenantAccessDenied);
  });
});

describe("membership service — last-owner safety", { skip: shouldSkip }, () => {
  it("prevents deactivating the sole owner", async () => {
    const { deactivateMembership } = await import("@/modules/memberships/membership-service");
    const { LastOwnerProtected } = await import("@/modules/memberships/role-policy");
    const seed = await seedOrganization();

    await expect(
      deactivateMembership({
        db: dbModule.db,
        context: seed.makeContext(),
        membershipId: seed.ownerMembershipId,
      }),
    ).rejects.toThrowError(LastOwnerProtected);
  });

  it("prevents revoking the owner role from the sole owner", async () => {
    const { revokeRole } = await import("@/modules/memberships/membership-service");
    const { LastOwnerProtected } = await import("@/modules/memberships/role-policy");
    const seed = await seedOrganization();

    await expect(
      revokeRole({
        db: dbModule.db,
        context: seed.makeContext(),
        membershipId: seed.ownerMembershipId,
        roleKey: "owner",
      }),
    ).rejects.toThrowError(LastOwnerProtected);
  });

  it("allows deactivating an owner when another owner exists", async () => {
    const { deactivateMembership, assignRole } =
      await import("@/modules/memberships/membership-service");
    const seed = await seedOrganization({
      secondUserEmail: "second-owner@example.test",
      secondRoleKey: "advisor",
    });

    // Grant the owner role to the second membership so there are two owners.
    await assignRole({
      db: dbModule.db,
      context: seed.makeContext(),
      membershipId: seed.secondMembershipId!,
      roleKey: "owner",
    });

    // Deactivating the original owner now succeeds because a second owner remains.
    await deactivateMembership({
      db: dbModule.db,
      context: seed.makeContext(),
      membershipId: seed.ownerMembershipId,
    });

    const deactivated = await dbModule.db.organizationMembership.findFirst({
      where: { id: seed.ownerMembershipId },
      select: { active: true },
    });
    expect(deactivated?.active).toBe(false);
  });
});

describe("membership service — cross-organization denial", { skip: shouldSkip }, () => {
  it("returns not-found for a membership in another organization", async () => {
    const { assignRole } = await import("@/modules/memberships/membership-service");
    const seedA = await seedOrganization({ secondUserEmail: "a@example.test" });
    const seedB = await seedOrganization();

    // org-A actor tries to act on org-B's owner membership — fails closed.
    await expect(
      assignRole({
        db: dbModule.db,
        context: seedA.makeContext(),
        membershipId: seedB.ownerMembershipId,
        roleKey: "technician",
      }),
    ).rejects.toMatchObject({ name: "MemberMutationFailed", reason: "membership_not_found" });
  });
});

describe("membership service — location access", { skip: shouldSkip }, () => {
  it("grants and revokes location access within the same organization", async () => {
    const { grantLocationAccess, revokeLocationAccess } =
      await import("@/modules/memberships/membership-service");
    const seed = await seedOrganization({ secondUserEmail: "member@example.test" });

    await grantLocationAccess({
      db: dbModule.db,
      context: seed.makeContext(),
      membershipId: seed.secondMembershipId!,
      locationId: seed.locationId,
    });
    const granted = await dbModule.db.locationAccess.findUnique({
      where: {
        membershipId_locationId: {
          membershipId: seed.secondMembershipId!,
          locationId: seed.locationId,
        },
      },
    });
    expect(granted).toBeTruthy();

    await revokeLocationAccess({
      db: dbModule.db,
      context: seed.makeContext(),
      membershipId: seed.secondMembershipId!,
      locationId: seed.locationId,
    });
    const after = await dbModule.db.locationAccess.findUnique({
      where: {
        membershipId_locationId: {
          membershipId: seed.secondMembershipId!,
          locationId: seed.locationId,
        },
      },
    });
    expect(after).toBeNull();
  });

  it("rejects granting a location from another organization", async () => {
    const { grantLocationAccess } = await import("@/modules/memberships/membership-service");
    const seedA = await seedOrganization({ secondUserEmail: "a@example.test" });
    const seedB = await seedOrganization();

    await expect(
      grantLocationAccess({
        db: dbModule.db,
        context: seedA.makeContext(),
        membershipId: seedA.secondMembershipId!,
        locationId: seedB.locationId,
      }),
    ).rejects.toMatchObject({ name: "MemberMutationFailed" });
  });
});

describe("membership service — invitations", { skip: shouldSkip }, () => {
  it("creates a pending invitation and records audit + outbox", async () => {
    const { inviteMember } = await import("@/modules/memberships/membership-service");
    const seed = await seedOrganization();

    const result = await inviteMember({
      db: dbModule.db,
      context: seed.makeContext(),
      email: "invitee@example.test",
      roleKey: "technician",
    });

    expect(result.invitationId).toBeTruthy();
    const audit = await dbModule.db.auditEvent.findFirst({
      where: { organizationId: seed.orgId, action: "membership.invited" },
    });
    expect(audit).toBeTruthy();
    const outbox = await dbModule.db.outboxEvent.findFirst({
      where: { organizationId: seed.orgId, eventType: "membership.invited" },
    });
    expect(outbox).toBeTruthy();
  });

  it("rejects a duplicate pending invitation for the same email", async () => {
    const { inviteMember } = await import("@/modules/memberships/membership-service");
    const seed = await seedOrganization();

    await inviteMember({
      db: dbModule.db,
      context: seed.makeContext(),
      email: "dupe@example.test",
      roleKey: "advisor",
    });
    await expect(
      inviteMember({
        db: dbModule.db,
        context: seed.makeContext(),
        email: "dupe@example.test",
        roleKey: "advisor",
      }),
    ).rejects.toMatchObject({ reason: "duplicate_pending_invitation" });
  });
});
