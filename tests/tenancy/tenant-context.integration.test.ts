import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * Integration test exercising the tenant-aware request context and the first
 * tenant-scoped repository against a throwaway PostgreSQL database.
 *
 * Seeds two organizations, a user with an active membership in org-A only, and a
 * customer in each organization. Asserts the adversarial denial paths required
 * by AGENTS.md and docs/tenancy-and-permissions.md: cross-organization access,
 * identifier guessing, unauthorized mutation, and location-limited rebuild.
 *
 * Requires SHOPOS_TEST_DATABASE_URL (defaults to the compose `shopos_test`
 * database) with migrations applied. Skips cleanly when Postgres is unreachable.
 */

const TEST_DATABASE_URL =
  process.env.SHOPOS_TEST_DATABASE_URL ?? "postgres://shopos:shopos@localhost:5432/shopos_test";

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
}, 30_000);

afterAll(async () => {
  if (!RUN) return;
  await dbModule.db.$disconnect();
});

/**
 * Seeds two orgs with a user, a membership, and a customer in each, returning
 * the deterministic IDs the tests need. A separate user-without-membership and
 * a location-limited membership are created inline where needed.
 */
async function seedTwoOrganizations(): Promise<{
  orgA: string;
  orgB: string;
  userA: string;
  membershipA: string;
  customerA: string;
  customerB: string;
}> {
  const orgA = randomUUID();
  const orgB = randomUUID();
  const userA = randomUUID();
  const membershipA = randomUUID();
  const roleId = randomUUID();
  const customerA = randomUUID();
  const customerB = randomUUID();

  await dbModule.db.$transaction([
    dbModule.db.organization.create({
      data: { id: orgA, slug: `org-a-${orgA.slice(0, 8)}`, name: "Org A" },
    }),
    dbModule.db.organization.create({
      data: { id: orgB, slug: `org-b-${orgB.slice(0, 8)}`, name: "Org B" },
    }),
    dbModule.db.user.create({
      data: {
        id: userA,
        email: `tenant-${userA.slice(0, 8)}@example.test`,
        displayName: "Tenant Tester",
      },
    }),
    dbModule.db.organizationMembership.create({
      data: {
        id: membershipA,
        organizationId: orgA,
        userId: userA,
        organizationWideLocationAccess: true,
      },
    }),
    dbModule.db.role.create({
      data: {
        id: roleId,
        organizationId: orgA,
        key: "owner",
        name: "Owner",
        permissions: ["customers.read", "customers.write", "work_orders.read"],
      },
    }),
    dbModule.db.membershipRole.create({
      data: { organizationId: orgA, membershipId: membershipA, roleId },
    }),
    dbModule.db.customer.create({
      data: { id: customerA, organizationId: orgA, kind: "INDIVIDUAL", displayName: "Customer A" },
    }),
    dbModule.db.customer.create({
      data: { id: customerB, organizationId: orgB, kind: "INDIVIDUAL", displayName: "Customer B" },
    }),
  ]);

  return { orgA, orgB, userA, membershipA, customerA, customerB };
}

beforeEach(async () => {
  if (!RUN) return;
  await dbModule.db.$transaction([
    dbModule.db.customer.deleteMany(),
    dbModule.db.locationAccess.deleteMany(),
    dbModule.db.membershipRole.deleteMany(),
    dbModule.db.role.deleteMany(),
    dbModule.db.organizationMembership.deleteMany(),
    dbModule.db.location.deleteMany(),
    dbModule.db.organization.deleteMany(),
    dbModule.db.user.deleteMany(),
  ]);
});

describe("resolveTenantContext against a real database", { skip: shouldSkip }, () => {
  it("rebuilds the context for an active membership in org-A", async () => {
    const { resolveTenantContext } = await import("@/modules/tenancy/resolve-tenant-context");
    const seed = await seedTwoOrganizations();

    const context = await resolveTenantContext({
      db: dbModule.db,
      actorId: seed.userA,
      organizationId: seed.orgA,
      requestId: "req-1",
    });

    expect(context.organizationId).toBe(seed.orgA);
    expect(context.membershipId).toBe(seed.membershipA);
    expect(context.permissions).toEqual(
      new Set(["customers.read", "customers.write", "work_orders.read"]),
    );
    expect(context.organizationWideLocationAccess).toBe(true);
  });

  it("fails closed for an actor with no membership in the requested organization", async () => {
    const { resolveTenantContext } = await import("@/modules/tenancy/resolve-tenant-context");
    const seed = await seedTwoOrganizations();

    await expect(
      resolveTenantContext({
        db: dbModule.db,
        actorId: seed.userA,
        organizationId: seed.orgB,
        requestId: "req-1",
      }),
    ).rejects.toMatchObject({ name: "TenantContextNotResolved", reason: "membership_not_found" });
  });

  it("rebuilds a location-limited membership and rejects an ungranted location", async () => {
    const { resolveTenantContext } = await import("@/modules/tenancy/resolve-tenant-context");
    const seed = await seedTwoOrganizations();
    const locationA = randomUUID();
    const locationOther = randomUUID();
    const limitedMembership = randomUUID();
    // Use a distinct user so we don't collide with the seed's org-wide membership.
    const limitedUser = randomUUID();

    await dbModule.db.$transaction([
      dbModule.db.user.create({
        data: {
          id: limitedUser,
          email: `limited-${limitedUser.slice(0, 8)}@example.test`,
          displayName: "Limited Tester",
        },
      }),
      dbModule.db.location.create({
        data: {
          id: locationA,
          organizationId: seed.orgA,
          code: "A",
          name: "Shop A",
          timeZone: "UTC",
        },
      }),
      dbModule.db.location.create({
        data: {
          id: locationOther,
          organizationId: seed.orgA,
          code: "X",
          name: "Shop X",
          timeZone: "UTC",
        },
      }),
      dbModule.db.organizationMembership.create({
        data: {
          id: limitedMembership,
          organizationId: seed.orgA,
          userId: limitedUser,
          organizationWideLocationAccess: false,
        },
      }),
      dbModule.db.locationAccess.create({
        data: { organizationId: seed.orgA, membershipId: limitedMembership, locationId: locationA },
      }),
    ]);

    const context = await resolveTenantContext({
      db: dbModule.db,
      actorId: limitedUser,
      organizationId: seed.orgA,
      requestId: "req-1",
    });

    // Adding a location later (locationOther) does not expand the limited membership.
    expect(context.organizationWideLocationAccess).toBe(false);
    expect(context.allowedLocationIds).toEqual(new Set([locationA]));
    expect(context.allowedLocationIds.has(locationOther)).toBe(false);
  });
});

describe(
  "CustomerRepository tenant isolation against a real database",
  { skip: shouldSkip },
  () => {
    it("reads a customer in the actor's own organization", async () => {
      const { CustomerRepository } = await import("@/modules/customers/customer-repository");
      const { resolveTenantContext } = await import("@/modules/tenancy/resolve-tenant-context");
      const seed = await seedTwoOrganizations();

      const context = await resolveTenantContext({
        db: dbModule.db,
        actorId: seed.userA,
        organizationId: seed.orgA,
        requestId: "req-1",
      });
      const repo = new CustomerRepository({ db: dbModule.db, context });

      const customer = await repo.findById(seed.customerA);
      expect(customer?.displayName).toBe("Customer A");
    });

    it("denies reading a customer from another organization (returns null, no existence leak)", async () => {
      const { CustomerRepository } = await import("@/modules/customers/customer-repository");
      const { resolveTenantContext } = await import("@/modules/tenancy/resolve-tenant-context");
      const seed = await seedTwoOrganizations();

      const context = await resolveTenantContext({
        db: dbModule.db,
        actorId: seed.userA,
        organizationId: seed.orgA,
        requestId: "req-1",
      });
      const repo = new CustomerRepository({ db: dbModule.db, context });

      const crossOrg = await repo.findById(seed.customerB);
      expect(crossOrg).toBeNull();
    });

    it("returns null for a guessed identifier", async () => {
      const { CustomerRepository } = await import("@/modules/customers/customer-repository");
      const { resolveTenantContext } = await import("@/modules/tenancy/resolve-tenant-context");
      const seed = await seedTwoOrganizations();

      const context = await resolveTenantContext({
        db: dbModule.db,
        actorId: seed.userA,
        organizationId: seed.orgA,
        requestId: "req-1",
      });
      const repo = new CustomerRepository({ db: dbModule.db, context });

      const guessed = await repo.findById(randomUUID());
      expect(guessed).toBeNull();
    });

    it("creates a customer in the actor's own organization", async () => {
      const { CustomerRepository } = await import("@/modules/customers/customer-repository");
      const { resolveTenantContext } = await import("@/modules/tenancy/resolve-tenant-context");
      const seed = await seedTwoOrganizations();

      const context = await resolveTenantContext({
        db: dbModule.db,
        actorId: seed.userA,
        organizationId: seed.orgA,
        requestId: "req-1",
      });
      const repo = new CustomerRepository({ db: dbModule.db, context });

      const created = await repo.create({ kind: "BUSINESS", displayName: "New Business" });
      expect(created.displayName).toBe("New Business");

      const persisted = await dbModule.db.customer.findFirst({
        where: { id: created.id, organizationId: seed.orgA },
      });
      expect(persisted?.organizationId).toBe(seed.orgA);
    });

    it("denies creation without the customers.write permission", async () => {
      const { CustomerRepository } = await import("@/modules/customers/customer-repository");
      const { resolveTenantContext } = await import("@/modules/tenancy/resolve-tenant-context");
      const { TenantAccessDenied } = await import("@/modules/tenancy/policy");
      const seed = await seedTwoOrganizations();
      const readOnlyRoleId = randomUUID();

      // Replace the owner role on the existing membership with a read-only role.
      await dbModule.db.membershipRole.deleteMany({ where: { membershipId: seed.membershipA } });
      await dbModule.db.$transaction([
        dbModule.db.role.create({
          data: {
            id: readOnlyRoleId,
            organizationId: seed.orgA,
            key: "viewer",
            name: "Viewer",
            permissions: ["customers.read"],
          },
        }),
        dbModule.db.membershipRole.create({
          data: {
            organizationId: seed.orgA,
            membershipId: seed.membershipA,
            roleId: readOnlyRoleId,
          },
        }),
      ]);

      const context = await resolveTenantContext({
        db: dbModule.db,
        actorId: seed.userA,
        organizationId: seed.orgA,
        requestId: "req-1",
      });
      const repo = new CustomerRepository({ db: dbModule.db, context });

      await expect(repo.create({ kind: "INDIVIDUAL", displayName: "Denied" })).rejects.toThrowError(
        TenantAccessDenied,
      );
    });
  },
);
