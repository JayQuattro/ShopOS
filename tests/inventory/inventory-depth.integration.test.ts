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

async function seedShop() {
  const orgId = randomUUID();
  const otherOrgId = randomUUID();
  const locationA = randomUUID();
  const locationB = randomUUID();
  const userId = randomUUID();
  const membershipId = randomUUID();
  const roleId = randomUUID();

  await dbModule.db.$transaction([
    dbModule.db.organization.create({
      data: { id: orgId, slug: `org-${orgId.slice(0, 8)}`, name: "Parts Org" },
    }),
    dbModule.db.organization.create({
      data: { id: otherOrgId, slug: `o-${otherOrgId.slice(0, 8)}`, name: "Other Org" },
    }),
    dbModule.db.location.create({
      data: { id: locationA, organizationId: orgId, code: "A", name: "Shop A", timeZone: "UTC" },
    }),
    dbModule.db.location.create({
      data: { id: locationB, organizationId: orgId, code: "B", name: "Shop B", timeZone: "UTC" },
    }),
    dbModule.db.user.create({
      data: {
        id: userId,
        email: `pt-${userId.slice(0, 8)}@example.test`,
        displayName: "Parts Manager",
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
        permissions: ["work_orders.write", "work_orders.read"],
      },
    }),
    dbModule.db.membershipRole.create({ data: { organizationId: orgId, membershipId, roleId } }),
  ]);

  const context = (
    overrides?: Partial<{
      organizationId: string;
      organizationWideLocationAccess: boolean;
      allowedLocationIds: ReadonlySet<string>;
      permissions: ReadonlySet<string>;
    }>,
  ) =>
    ({
      actorId: userId,
      organizationId: overrides?.organizationId ?? orgId,
      membershipId,
      requestId: randomUUID(),
      organizationWideLocationAccess: overrides?.organizationWideLocationAccess ?? true,
      allowedLocationIds: overrides?.allowedLocationIds ?? new Set<string>(),
      permissions: overrides?.permissions ?? new Set(["work_orders.write", "work_orders.read"]),
    }) as import("@/modules/tenancy/policy").TenantContext;

  return { orgId, otherOrgId, locationA, locationB, context };
}

describe("inventory depth (#213)", { skip: shouldSkip }, () => {
  it("scopes items per location while org-wide stock stays shared", async () => {
    const inventory = await import("@/modules/inventory/inventory-service");
    const seed = await seedShop();

    // The same part number at two shops plus a shared org-wide item.
    await inventory.createItem({
      db: dbModule.db,
      context: seed.context(),
      partNumber: "BRK-001",
      name: "Front pads",
      locationId: seed.locationA,
      quantityOnHand: 10,
    });
    await inventory.createItem({
      db: dbModule.db,
      context: seed.context(),
      partNumber: "BRK-001",
      name: "Front pads",
      locationId: seed.locationB,
      quantityOnHand: 4,
    });
    const shared = await inventory.createItem({
      db: dbModule.db,
      context: seed.context(),
      partNumber: "OIL-5W30",
      name: "Motor oil 5W-30",
      quantityOnHand: 40,
    });
    void shared;

    const all = await inventory.listItems({ db: dbModule.db, context: seed.context() });
    expect(all).toHaveLength(3);

    // Location B filter sees its own stock plus the shared item.
    const atB = await inventory.listItems(
      {
        db: dbModule.db,
        context: seed.context(),
      },
      { locationId: seed.locationB },
    );
    expect(atB.map((item) => item.partNumber).sort()).toEqual(["BRK-001", "OIL-5W30"]);

    // A location-restricted viewer sees the same picture for their shop.
    const restricted = await inventory.listItems({
      db: dbModule.db,
      context: seed.context({
        organizationWideLocationAccess: false,
        allowedLocationIds: new Set([seed.locationB]),
      }),
    });
    expect(restricted.map((item) => item.partNumber).sort()).toEqual(["BRK-001", "OIL-5W30"]);

    // Duplicate part numbers per location refused; other locations fine.
    await expect(
      inventory.createItem({
        db: dbModule.db,
        context: seed.context(),
        partNumber: "BRK-001",
        name: "Front pads again",
        locationId: seed.locationA,
      }),
    ).rejects.toMatchObject({ reason: "duplicate_part_number" });
  });

  it("carries part identity, condition, core, consumable, and UoM", async () => {
    const inventory = await import("@/modules/inventory/inventory-service");
    const seed = await seedShop();

    const { categoryId } = await inventory.createCategory({
      db: dbModule.db,
      context: seed.context(),
      name: "Brakes",
    });
    const { itemId } = await inventory.createItem({
      db: dbModule.db,
      context: seed.context(),
      partNumber: "MC-1234",
      name: "Brake master cylinder",
      oeNumber: "OE-44100",
      brand: "Aisin",
      categoryId,
      condition: "refurb",
      hasCore: true,
      coreValueMinor: 3_000,
      uomGroup: "each",
      unitOfMeasure: "each",
      uomFactorMilli: 1000,
      quantityOnHand: 2,
    });

    const item = await dbModule.db.inventoryItem.findUnique({
      where: { id: itemId },
      select: {
        oeNumber: true,
        brand: true,
        condition: true,
        hasCore: true,
        coreValueMinor: true,
        uomGroup: true,
        unitOfMeasure: true,
        uomFactorMilli: true,
        category: { select: { name: true } },
      },
    });
    expect(item?.oeNumber).toBe("OE-44100");
    expect(item?.brand).toBe("Aisin");
    expect(item?.condition).toBe("refurb");
    expect(item?.coreValueMinor).toBe(3_000n);
    expect(item?.uomFactorMilli).toBe(1000);
    expect(item?.category?.name).toBe("Brakes");

    // A core value without hasCore is refused.
    await expect(
      inventory.createItem({
        db: dbModule.db,
        context: seed.context(),
        partNumber: "NO-CORE",
        name: "Something",
        coreValueMinor: 1_000,
      }),
    ).rejects.toMatchObject({ reason: "invalid_quantity" });

    // Consumables list filters.
    await inventory.createItem({
      db: dbModule.db,
      context: seed.context(),
      partNumber: "RAG-001",
      name: "Shop rags (bag)",
      consumable: true,
      nonSaleable: true,
    });
    const consumables = await inventory.listItems(
      { db: dbModule.db, context: seed.context() },
      { consumablesOnly: true },
    );
    expect(consumables.map((item) => item.partNumber)).toEqual(["RAG-001"]);
    expect(consumables[0]?.nonSaleable).toBe(true);
  });

  it("finds interchangeable parts by OE number across manufacturers", async () => {
    const inventory = await import("@/modules/inventory/inventory-service");
    const seed = await seedShop();

    // Three aftermarket numbers, one OE interchange, different brands.
    for (const [partNumber, brand] of [
      ["MC-AIS-1", "Aisin"],
      ["MC-BOC-2", "Bosch"],
      ["MC-DEN-3", "Denso"],
    ] as const) {
      await inventory.createItem({
        db: dbModule.db,
        context: seed.context(),
        partNumber,
        name: "Brake master cylinder",
        oeNumber: "OE-44100",
        brand,
        quantityOnHand: 3,
      });
    }
    await inventory.createItem({
      db: dbModule.db,
      context: seed.context(),
      partNumber: "UNRELATED",
      name: "Wiper blades",
      oeNumber: "OE-99999",
    });

    const matches = await inventory.findInterchange({
      db: dbModule.db,
      context: seed.context(),
      oeNumber: "OE-44100",
    });
    expect(matches).toHaveLength(3);
    expect(new Set(matches.map((match) => match.brand))).toEqual(
      new Set(["Aisin", "Bosch", "Denso"]),
    );

    // Another org's OE number finds nothing.
    await expect(
      inventory.findInterchange({
        db: dbModule.db,
        context: seed.context({ organizationId: seed.otherOrgId }),
        oeNumber: "OE-44100",
      }),
    ).resolves.toEqual([]);
  });

  it("dedupes category names per organization and scopes cross-org", async () => {
    const inventory = await import("@/modules/inventory/inventory-service");
    const seed = await seedShop();

    await inventory.createCategory({ db: dbModule.db, context: seed.context(), name: "Brakes" });
    await expect(
      inventory.createCategory({ db: dbModule.db, context: seed.context(), name: "Brakes" }),
    ).rejects.toMatchObject({ reason: "duplicate_part_number" });

    // Same name in another org is fine.
    await inventory.createCategory({
      db: dbModule.db,
      context: seed.context({ organizationId: seed.otherOrgId }),
      name: "Brakes",
    });

    const categories = await inventory.listCategories({ db: dbModule.db, context: seed.context() });
    expect(categories).toHaveLength(1);
    expect(categories[0]?.itemCount).toBe(0);
  });
});
