import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { assertDedicatedTestDatabase, resetTestDatabase } from "../helpers/database";

/**
 * Cross-cutting tenant-isolation security matrix.
 *
 * This is the dedicated artifact for issue #10: it consolidates the adversarial
 * denial paths required by docs/tenancy-and-permissions.md into one file so a
 * reviewer can verify the security posture without scanning every module test.
 *
 * Covers: cross-org read/mutation denial, identifier guessing, no-existence-
 * leak, suspended-org inaccessibility, stale-membership denial, org-wide vs
 * location-limited access, permission-denial with valid tenant scope.
 *
 * Requires SHOPOS_TEST_DATABASE_URL. Skips cleanly when Postgres is unreachable.
 *
 * Nested-resource confusion (child ID from org A through a parent in org B) is
 * not covered here because no location-scoped repository with parent references
 * (WorkOrder/Asset) exists yet; the schema's compound tenant FKs enforce it at
 * the DB level, and the service-level test lands with that module.
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

type TenantContext = import("@/modules/tenancy/policy").TenantContext;

/**
 * Seeds a full org with two locations, an owner membership (org-wide), and
 * returns a context factory. Optionally seeds a second org for cross-org tests.
 */
async function seedOrg(options?: {
  status?: "ACTIVE" | "SUSPENDED";
  orgWide?: boolean;
  permissions?: readonly string[];
}): Promise<{
  orgId: string;
  locationAId: string;
  locationBId: string;
  userId: string;
  membershipId: string;
  customerAId: string;
  makeContext: (overrides?: { permissions?: readonly string[] }) => TenantContext;
}> {
  const orgId = randomUUID();
  const locationAId = randomUUID();
  const locationBId = randomUUID();
  const userId = randomUUID();
  const membershipId = randomUUID();
  const roleId = randomUUID();
  const customerAId = randomUUID();

  await dbModule.db.$transaction([
    dbModule.db.organization.create({
      data: {
        id: orgId,
        slug: `org-${orgId.slice(0, 8)}`,
        name: "Matrix Org",
        status: options?.status ?? "ACTIVE",
      },
    }),
    dbModule.db.location.create({
      data: { id: locationAId, organizationId: orgId, code: "A", name: "Loc A", timeZone: "UTC" },
    }),
    dbModule.db.location.create({
      data: { id: locationBId, organizationId: orgId, code: "B", name: "Loc B", timeZone: "UTC" },
    }),
    dbModule.db.user.create({
      data: {
        id: userId,
        email: `u-${userId.slice(0, 8)}@example.test`,
        displayName: "Matrix User",
      },
    }),
    dbModule.db.organizationMembership.create({
      data: {
        id: membershipId,
        organizationId: orgId,
        userId,
        organizationWideLocationAccess: options?.orgWide ?? true,
      },
    }),
    dbModule.db.role.create({
      data: {
        id: roleId,
        organizationId: orgId,
        key: "owner",
        name: "Owner",
        permissions: [...(options?.permissions ?? ALL_PERMISSIONS)],
      },
    }),
    dbModule.db.membershipRole.create({ data: { organizationId: orgId, membershipId, roleId } }),
    dbModule.db.customer.create({
      data: {
        id: customerAId,
        organizationId: orgId,
        kind: "INDIVIDUAL",
        displayName: "Matrix Customer",
      },
    }),
  ]);

  return {
    orgId,
    locationAId,
    locationBId,
    userId,
    membershipId,
    customerAId,
    makeContext: (overrides) =>
      ({
        actorId: userId,
        organizationId: orgId,
        membershipId,
        requestId: randomUUID(),
        organizationWideLocationAccess: options?.orgWide ?? true,
        allowedLocationIds: new Set<string>(),
        permissions: new Set(overrides?.permissions ?? options?.permissions ?? ALL_PERMISSIONS),
      }) as TenantContext,
  };
}

describe("cross-organization isolation", { skip: shouldSkip }, () => {
  it("denies reading a customer from another organization (returns null, no leak)", async () => {
    const { CustomerRepository } = await import("@/modules/customers/customer-repository");
    const seedA = await seedOrg();
    const seedB = await seedOrg();

    const repo = new CustomerRepository({ db: dbModule.db, context: seedA.makeContext() });
    const crossOrg = await repo.findById(seedB.customerAId);

    expect(crossOrg).toBeNull();
  });

  it("returns null for a guessed customer identifier (uniform with not-found)", async () => {
    const { CustomerRepository } = await import("@/modules/customers/customer-repository");
    const seed = await seedOrg();

    const repo = new CustomerRepository({ db: dbModule.db, context: seed.makeContext() });
    const guessed = await repo.findById(randomUUID());
    const missing = await repo.findById(randomUUID());

    expect(guessed).toBeNull();
    expect(missing).toBeNull();
  });

  it("denies creating a customer without the customers.write permission", async () => {
    const { CustomerRepository } = await import("@/modules/customers/customer-repository");
    const { TenantAccessDenied } = await import("@/modules/tenancy/policy");
    const seed = await seedOrg({ permissions: ["customers.read"] });

    const repo = new CustomerRepository({ db: dbModule.db, context: seed.makeContext() });
    await expect(repo.create({ kind: "INDIVIDUAL", displayName: "Denied" })).rejects.toThrowError(
      TenantAccessDenied,
    );
  });

  it("returns null for a cross-org membership read (no existence leak)", async () => {
    const { MembershipRepository } = await import("@/modules/memberships/membership-repository");
    const seedA = await seedOrg();
    const seedB = await seedOrg();

    const repo = new MembershipRepository({ db: dbModule.db, context: seedA.makeContext() });
    const crossOrg = await repo.findMembershipById(seedB.membershipId);
    const nonexistent = await repo.findMembershipById(randomUUID());

    expect(crossOrg).toBeNull();
    expect(nonexistent).toBeNull();
  });
});

describe("suspended-organization inaccessibility", { skip: shouldSkip }, () => {
  it("denies resolving tenant context for a suspended organization", async () => {
    const { resolveTenantContext } = await import("@/modules/tenancy/resolve-tenant-context");
    const { TenantContextNotResolved } = await import("@/modules/tenancy/resolve-tenant-context");
    const seed = await seedOrg({ status: "SUSPENDED" });

    await expect(
      resolveTenantContext({
        db: dbModule.db,
        actorId: seed.userId,
        organizationId: seed.orgId,
        requestId: "req-1",
      }),
    ).rejects.toMatchObject({
      name: "TenantContextNotResolved",
      reason: "organization_suspended",
    });
    expect(new TenantContextNotResolved("organization_suspended")).toBeInstanceOf(
      TenantContextNotResolved,
    );
  });

  it("allows resolving tenant context for an active organization", async () => {
    const { resolveTenantContext } = await import("@/modules/tenancy/resolve-tenant-context");
    const seed = await seedOrg({ status: "ACTIVE" });

    const context = await resolveTenantContext({
      db: dbModule.db,
      actorId: seed.userId,
      organizationId: seed.orgId,
      requestId: "req-1",
    });

    expect(context.organizationId).toBe(seed.orgId);
    expect(context.membershipId).toBe(seed.membershipId);
  });
});

describe("stale-membership denial", { skip: shouldSkip }, () => {
  it("denies resolving tenant context after the membership is deactivated", async () => {
    const { resolveTenantContext } = await import("@/modules/tenancy/resolve-tenant-context");
    const { deactivateMembership } = await import("@/modules/memberships/membership-service");
    const seed = await seedOrg();

    // Seed a second owner so deactivating the first doesn't hit the last-owner
    // invariant (which is tested separately in the membership suite).
    const secondUserId = randomUUID();
    const secondMembershipId = randomUUID();
    await dbModule.db.$transaction([
      dbModule.db.user.create({
        data: {
          id: secondUserId,
          email: `u2-${secondUserId.slice(0, 8)}@example.test`,
          displayName: "Second Owner",
        },
      }),
      dbModule.db.organizationMembership.create({
        data: {
          id: secondMembershipId,
          organizationId: seed.orgId,
          userId: secondUserId,
          authRole: "owner",
          organizationWideLocationAccess: true,
        },
      }),
    ]);

    // First, resolution succeeds.
    await resolveTenantContext({
      db: dbModule.db,
      actorId: seed.userId,
      organizationId: seed.orgId,
      requestId: "req-1",
    });

    // Deactivate the first membership (second owner remains).
    await deactivateMembership({
      db: dbModule.db,
      context: seed.makeContext(),
      membershipId: seed.membershipId,
    });

    // Subsequent resolution for the deactivated membership fails closed.
    await expect(
      resolveTenantContext({
        db: dbModule.db,
        actorId: seed.userId,
        organizationId: seed.orgId,
        requestId: "req-2",
      }),
    ).rejects.toMatchObject({ reason: "membership_inactive" });
  });
});

describe("location-access boundaries", { skip: shouldSkip }, () => {
  it("allows an org-wide actor to access all locations", async () => {
    const { assertLocationCanBeSelected } = await import("@/modules/tenancy/policy");
    const { resolveTenantContext } = await import("@/modules/tenancy/resolve-tenant-context");
    const seed = await seedOrg({ orgWide: true });

    const context = await resolveTenantContext({
      db: dbModule.db,
      actorId: seed.userId,
      organizationId: seed.orgId,
      requestId: "req-1",
    });

    expect(context.organizationWideLocationAccess).toBe(true);
    expect(() => assertLocationCanBeSelected(context, seed.locationAId)).not.toThrow();
    expect(() => assertLocationCanBeSelected(context, seed.locationBId)).not.toThrow();
  });

  it("does not expand a location-limited membership when a new location is added", async () => {
    const { resolveTenantContext } = await import("@/modules/tenancy/resolve-tenant-context");
    // Seed with orgWide=false and grant only location A.
    const orgId = randomUUID();
    const locationAId = randomUUID();
    const locationBId = randomUUID();
    const userId = randomUUID();
    const membershipId = randomUUID();
    const roleId = randomUUID();

    await dbModule.db.$transaction([
      dbModule.db.organization.create({
        data: { id: orgId, slug: `org-${orgId.slice(0, 8)}`, name: "Limited Org" },
      }),
      dbModule.db.location.create({
        data: { id: locationAId, organizationId: orgId, code: "A", name: "Loc A", timeZone: "UTC" },
      }),
      dbModule.db.user.create({
        data: {
          id: userId,
          email: `u-${userId.slice(0, 8)}@example.test`,
          displayName: "Limited User",
        },
      }),
      dbModule.db.organizationMembership.create({
        data: {
          id: membershipId,
          organizationId: orgId,
          userId,
          organizationWideLocationAccess: false,
        },
      }),
      dbModule.db.role.create({
        data: {
          id: roleId,
          organizationId: orgId,
          key: "tech",
          name: "Tech",
          permissions: ["work_orders.read"],
        },
      }),
      dbModule.db.membershipRole.create({ data: { organizationId: orgId, membershipId, roleId } }),
      dbModule.db.locationAccess.create({
        data: { organizationId: orgId, membershipId, locationId: locationAId },
      }),
    ]);

    const context = await resolveTenantContext({
      db: dbModule.db,
      actorId: userId,
      organizationId: orgId,
      requestId: "req-1",
    });

    expect(context.organizationWideLocationAccess).toBe(false);
    expect(context.allowedLocationIds).toEqual(new Set([locationAId]));

    // Add a new location after the membership was created.
    await dbModule.db.location.create({
      data: { id: locationBId, organizationId: orgId, code: "B", name: "Loc B", timeZone: "UTC" },
    });

    // Re-resolve — the new location must NOT appear in the allowed set.
    const reResolved = await resolveTenantContext({
      db: dbModule.db,
      actorId: userId,
      organizationId: orgId,
      requestId: "req-2",
    });
    expect(reResolved.allowedLocationIds.has(locationBId)).toBe(false);
  });
});
