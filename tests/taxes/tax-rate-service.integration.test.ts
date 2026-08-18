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
      data: { id: orgId, slug: `org-${orgId.slice(0, 8)}`, name: "Tax Org" },
    }),
    dbModule.db.user.create({
      data: { id: userId, email: `t-${userId.slice(0, 8)}@example.test`, displayName: "Tax User" },
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
        permissions: ["work_orders.read", "organizations.manage"],
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
      permissions: new Set(["work_orders.read", "organizations.manage"] as const),
    }) as import("@/modules/tenancy/policy").TenantContext;
}

describe("tax rates (#167)", { skip: shouldSkip }, () => {
  it("creates, lists, and deactivates named rates", async () => {
    const { createTaxRate, listTaxRates, deactivateTaxRate } =
      await import("@/modules/taxes/tax-rate-service");
    const context = (await seedOrg())();

    await createTaxRate({
      db: dbModule.db,
      context,
      name: "State sales tax",
      rateBasisPoints: 625,
    });
    const { taxRateId } = await createTaxRate({
      db: dbModule.db,
      context,
      name: "County tax",
      rateBasisPoints: 150,
    });

    let rates = await listTaxRates({ db: dbModule.db, context });
    expect(rates).toHaveLength(2);
    const state = rates.find((rate) => rate.name === "State sales tax");
    expect(state?.rateBasisPoints).toBe(625);

    await deactivateTaxRate({ db: dbModule.db, context, taxRateId });
    rates = await listTaxRates({ db: dbModule.db, context });
    expect(rates).toHaveLength(1);
    const all = await listTaxRates({ db: dbModule.db, context, includeInactive: true });
    expect(all).toHaveLength(2);
  });

  it("rejects duplicates, out-of-range rates, and stays tenant-scoped", async () => {
    const { createTaxRate, deactivateTaxRate } = await import("@/modules/taxes/tax-rate-service");
    const contextA = (await seedOrg())();
    const contextB = (await seedOrg())();

    await expect(
      createTaxRate({ db: dbModule.db, context: contextA, name: "X", rateBasisPoints: 10001 }),
    ).rejects.toMatchObject({ reason: "invalid_rate" });

    await createTaxRate({
      db: dbModule.db,
      context: contextA,
      name: "Shared",
      rateBasisPoints: 500,
    });
    await expect(
      createTaxRate({ db: dbModule.db, context: contextA, name: "Shared", rateBasisPoints: 500 }),
    ).rejects.toMatchObject({ reason: "duplicate_name" });

    // Same name is legal in another org; B's actor can't touch A's rate.
    const created = await createTaxRate({
      db: dbModule.db,
      context: contextB,
      name: "Shared",
      rateBasisPoints: 700,
    });
    const rateA = await dbModule.db.taxRate.findFirst({
      where: { organizationId: contextA.organizationId },
    });
    await expect(
      deactivateTaxRate({ db: dbModule.db, context: contextB, taxRateId: rateA!.id }),
    ).rejects.toMatchObject({ reason: "tax_rate_not_found" });
    void created;
  });
});
