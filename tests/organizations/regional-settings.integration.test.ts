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

async function seedShop(input?: { orgCurrency?: string; orgLocale?: string | null }) {
  const orgId = randomUUID();
  const otherOrgId = randomUUID();
  const locationId = randomUUID();
  const secondLocationId = randomUUID();
  const userId = randomUUID();
  const membershipId = randomUUID();
  const roleId = randomUUID();

  await dbModule.db.$transaction([
    dbModule.db.organization.create({
      data: {
        id: orgId,
        slug: `org-${orgId.slice(0, 8)}`,
        name: "Regional Org",
        defaultCurrency: input?.orgCurrency ?? "USD",
        ...(input?.orgLocale !== undefined ? { defaultLocale: input.orgLocale } : {}),
      },
    }),
    dbModule.db.organization.create({
      data: { id: otherOrgId, slug: `other-${otherOrgId.slice(0, 8)}`, name: "Other Org" },
    }),
    dbModule.db.location.create({
      data: {
        id: locationId,
        organizationId: orgId,
        code: "US1",
        name: "US Shop",
        timeZone: "America/New_York",
      },
    }),
    dbModule.db.location.create({
      data: {
        id: secondLocationId,
        organizationId: orgId,
        code: "CA1",
        name: "Canada Shop",
        timeZone: "America/Toronto",
      },
    }),
    dbModule.db.user.create({
      data: {
        id: userId,
        email: `rg-${userId.slice(0, 8)}@example.test`,
        displayName: "Regional Admin",
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
        permissions: ["organizations.manage", "payments.record"],
      },
    }),
    dbModule.db.membershipRole.create({ data: { organizationId: orgId, membershipId, roleId } }),
  ]);

  const context = (permissions?: readonly string[]) =>
    ({
      actorId: userId,
      organizationId: orgId,
      membershipId,
      requestId: randomUUID(),
      organizationWideLocationAccess: true,
      allowedLocationIds: new Set<string>(),
      permissions: new Set<string>(permissions ?? ["organizations.manage"]),
    }) as import("@/modules/tenancy/policy").TenantContext;

  return { orgId, otherOrgId, locationId, secondLocationId, context };
}

describe("regional settings (#193)", { skip: shouldSkip }, () => {
  it("resolves location overrides over org defaults over USD/en-US", async () => {
    const regional = await import("@/modules/organizations/regional-settings");
    const seed = await seedShop({ orgCurrency: "EUR", orgLocale: "pt-BR" });

    // No location: org defaults.
    expect(await regional.resolveRegionalSettings(dbModule.db, seed.orgId)).toEqual({
      currency: "EUR",
      locale: "pt-BR",
    });

    // Location with no overrides: org defaults still.
    expect(
      await regional.resolveRegionalSettings(dbModule.db, seed.orgId, seed.locationId),
    ).toEqual({ currency: "EUR", locale: "pt-BR" });

    // Canadian location overrides both.
    await regional.updateLocationRegionalSettings({
      db: dbModule.db,
      context: seed.context(),
      locationId: seed.secondLocationId,
      currency: "CAD",
      locale: "fr-CA",
    });
    expect(
      await regional.resolveRegionalSettings(dbModule.db, seed.orgId, seed.secondLocationId),
    ).toEqual({ currency: "CAD", locale: "fr-CA" });
    // Sibling untouched.
    expect(
      await regional.resolveRegionalSettings(dbModule.db, seed.orgId, seed.locationId),
    ).toEqual({ currency: "EUR", locale: "pt-BR" });

    // Clearing overrides falls back to the org defaults.
    await regional.updateLocationRegionalSettings({
      db: dbModule.db,
      context: seed.context(),
      locationId: seed.secondLocationId,
      currency: null,
      locale: null,
    });
    expect(
      await regional.resolveRegionalSettings(dbModule.db, seed.orgId, seed.secondLocationId),
    ).toEqual({ currency: "EUR", locale: "pt-BR" });

    // A location from another organization resolves nothing — its overrides
    // can never leak.
    expect(await regional.resolveRegionalSettings(dbModule.db, seed.orgId, randomUUID())).toEqual({
      currency: "EUR",
      locale: "pt-BR",
    });
  });

  it("defaults to USD/en-US when nothing is configured", async () => {
    const regional = await import("@/modules/organizations/regional-settings");
    const seed = await seedShop();

    expect(await regional.resolveRegionalSettings(dbModule.db, seed.orgId)).toEqual({
      currency: "USD",
      locale: "en-US",
    });
  });

  it("validates currency and locale shapes, rejects foreign locations and non-managers", async () => {
    const regional = await import("@/modules/organizations/regional-settings");
    const { TenantAccessDenied } = await import("@/modules/tenancy/policy");
    const seed = await seedShop();

    await expect(
      regional.updateLocationRegionalSettings({
        db: dbModule.db,
        context: seed.context(),
        locationId: seed.locationId,
        currency: "dollars",
      }),
    ).rejects.toMatchObject({ reason: "invalid_currency" });

    await expect(
      regional.updateLocationRegionalSettings({
        db: dbModule.db,
        context: seed.context(),
        locationId: seed.locationId,
        locale: "not a locale!!",
      }),
    ).rejects.toMatchObject({ reason: "invalid_locale" });

    // A location from another organization is not found in this tenant.
    await expect(
      regional.updateLocationRegionalSettings({
        db: dbModule.db,
        context: seed.context(),
        locationId: randomUUID(),
        currency: "CAD",
      }),
    ).rejects.toMatchObject({ reason: "location_not_found" });

    await expect(
      regional.updateLocationRegionalSettings({
        db: dbModule.db,
        context: seed.context(["payments.record"]),
        locationId: seed.locationId,
        currency: "CAD",
      }),
    ).rejects.toThrowError(TenantAccessDenied);
  });

  it("formats money with the resolved locale in the shape customers see", async () => {
    // The point of the setting: 123456 minor in EUR renders per locale.
    const { formatMoney } = await import("@/i18n/formatters");
    const enUS = formatMoney(123456, "EUR", "en-US");
    const deDE = formatMoney(123456, "EUR", "de-DE");
    const ptBR = formatMoney(123456, "BRL", "pt-BR");
    expect(enUS.replace(/\u00A0/g, " ")).toContain("1,234.56");
    expect(deDE.replace(/\u00A0|\u202F/g, ".")).toContain("1.234,56");
    expect(ptBR.replace(/\u00A0|\u202F/g, " ")).toContain("1.234,56");
  });
});
