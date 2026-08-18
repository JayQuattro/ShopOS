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

async function seedOrg() {
  const orgId = randomUUID();
  const userId = randomUUID();
  const membershipId = randomUUID();
  const roleId = randomUUID();

  await dbModule.db.$transaction([
    dbModule.db.organization.create({
      data: { id: orgId, slug: `org-${orgId.slice(0, 8)}`, name: "Profile Org" },
    }),
    dbModule.db.user.create({
      data: {
        id: userId,
        email: `pr-${userId.slice(0, 8)}@example.test`,
        displayName: "Profile User",
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
        permissions: ["organizations.manage"],
      },
    }),
    dbModule.db.membershipRole.create({ data: { organizationId: orgId, membershipId, roleId } }),
  ]);

  return () =>
    ({
      actorId: userId,
      organizationId: orgId,
      membershipId,
      requestId: randomUUID(),
      organizationWideLocationAccess: true,
      allowedLocationIds: new Set<string>(),
      permissions: new Set(["organizations.manage"] as const),
    }) as import("@/modules/tenancy/policy").TenantContext;
}

describe("shop profile settings (#162)", { skip: shouldSkip }, () => {
  it("round-trips the profile with audit and normalization", async () => {
    const { getShopProfile, updateShopProfile } =
      await import("@/modules/organizations/org-profile-service");
    const context = await seedOrg();

    await updateShopProfile(dbModule.db, context(), {
      name: "Ridgeline Auto",
      contactPhone: "(555) 010-0100",
      contactEmail: "shop@ridgeline.example",
      website: "https://ridgeline.example",
      addressLine1: "123 Main St",
      city: "Raleigh",
      stateProvince: "NC",
      postalCode: "27601",
      country: "us",
    });

    const profile = await getShopProfile(dbModule.db, context());
    expect(profile.name).toBe("Ridgeline Auto");
    expect(profile.contactPhone).toBe("(555) 010-0100");
    expect(profile.country).toBe("US"); // uppercased
    expect(profile.addressLine2).toBeNull();

    const audit = await dbModule.db.auditEvent.findFirst({
      where: { action: "organization.profile_updated" },
    });
    expect(audit?.after).toMatchObject({ name: "Ridgeline Auto", city: "Raleigh" });

    // Empty strings clear optional fields.
    await updateShopProfile(dbModule.db, context(), {
      name: "Ridgeline Auto",
      contactPhone: "",
    });
    const cleared = await getShopProfile(dbModule.db, context());
    expect(cleared.contactPhone).toBeNull();
  });

  it("rejects invalid websites, countries, and names", async () => {
    const { updateShopProfile } = await import("@/modules/organizations/org-profile-service");
    const context = await seedOrg();

    await expect(
      updateShopProfile(dbModule.db, context(), { name: "Valid", website: "ridgeline.example" }),
    ).rejects.toMatchObject({ reason: "invalid_website" });
    await expect(
      updateShopProfile(dbModule.db, context(), { name: "Valid", country: "USA" }),
    ).rejects.toMatchObject({ reason: "invalid_country" });
    await expect(updateShopProfile(dbModule.db, context(), { name: "x" })).rejects.toMatchObject({
      reason: "invalid_name",
    });
  });

  it("requires organizations.manage and stays tenant-scoped", async () => {
    const { getShopProfile, updateShopProfile } =
      await import("@/modules/organizations/org-profile-service");
    const contextA = await seedOrg();
    const contextB = await seedOrg();

    const noManage = {
      ...contextA(),
      permissions: new Set(["work_orders.read"] as const),
    };
    await expect(getShopProfile(dbModule.db, noManage)).rejects.toThrow();

    // Service scopes strictly by context.organizationId: actor B updating
    // "their" org never reaches org A's row.
    await updateShopProfile(dbModule.db, contextB(), { name: "B Own Name" });
    const profileA = await getShopProfile(dbModule.db, contextA());
    expect(profileA.name).toBe("Profile Org");
  });
});
