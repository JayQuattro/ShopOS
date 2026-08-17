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

async function seedOrgWithManager(permission: "organizations.manage" | "work_orders.read") {
  const orgId = randomUUID();
  const userId = randomUUID();
  const membershipId = randomUUID();
  const roleId = randomUUID();

  await dbModule.db.$transaction([
    dbModule.db.organization.create({
      data: { id: orgId, slug: `org-${orgId.slice(0, 8)}`, name: "Prefs Org" },
    }),
    dbModule.db.user.create({
      data: {
        id: userId,
        email: `u-${userId.slice(0, 8)}@example.test`,
        displayName: "Prefs User",
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
        key: "custom",
        name: "Custom",
        permissions: [permission],
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
      permissions: new Set([permission] as const),
    }) as import("@/modules/tenancy/policy").TenantContext;
}

describe("work preferences (#130)", { skip: shouldSkip }, () => {
  it("reads the organization defaults", async () => {
    const { getWorkPreferences } = await import("@/modules/estimates/work-preferences-service");
    const context = await seedOrgWithManager("organizations.manage");
    const preferences = await getWorkPreferences(dbModule.db, context());
    expect(preferences).toEqual({
      changeOrderCreditPolicy: "AUTO_APPLY",
      invoiceLinePolicy: "APPROVED_ONLY",
      defaultPaperSize: "LETTER",
    });
  });

  it("updates both policies and records an audit event", async () => {
    const { getWorkPreferences, updateWorkPreferences } =
      await import("@/modules/estimates/work-preferences-service");
    const context = await seedOrgWithManager("organizations.manage");
    await updateWorkPreferences(dbModule.db, context(), {
      changeOrderCreditPolicy: "REQUIRE_APPROVAL",
      invoiceLinePolicy: "ALL_LINES",
      defaultPaperSize: "A4",
    });

    const preferences = await getWorkPreferences(dbModule.db, context());
    expect(preferences).toEqual({
      changeOrderCreditPolicy: "REQUIRE_APPROVAL",
      invoiceLinePolicy: "ALL_LINES",
      defaultPaperSize: "A4",
    });

    const audit = await dbModule.db.auditEvent.findFirst({
      where: { action: "organization.work_preferences_updated" },
    });
    expect(audit?.after).toMatchObject({
      changeOrderCreditPolicy: "REQUIRE_APPROVAL",
      invoiceLinePolicy: "ALL_LINES",
    });
  });

  it("denies reads and writes without organizations.manage", async () => {
    const { getWorkPreferences, updateWorkPreferences } =
      await import("@/modules/estimates/work-preferences-service");
    const context = await seedOrgWithManager("work_orders.read");
    await expect(getWorkPreferences(dbModule.db, context())).rejects.toThrow();
    await expect(
      updateWorkPreferences(dbModule.db, context(), {
        changeOrderCreditPolicy: "REQUIRE_APPROVAL",
        invoiceLinePolicy: "ALL_LINES",
        defaultPaperSize: "LEGAL",
      }),
    ).rejects.toThrow();
  });
});
