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

async function seed() {
  const orgId = randomUUID();
  const userId = randomUUID();
  const membershipId = randomUUID();
  const roleId = randomUUID();

  await dbModule.db.$transaction([
    dbModule.db.organization.create({
      data: { id: orgId, slug: `org-${orgId.slice(0, 8)}`, name: "Inv Org" },
    }),
    dbModule.db.user.create({
      data: { id: userId, email: `i-${userId.slice(0, 8)}@example.test`, displayName: "Inv User" },
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
        permissions: ["work_orders.read", "work_orders.write"],
      },
    }),
    dbModule.db.membershipRole.create({ data: { organizationId: orgId, membershipId, roleId } }),
  ]);

  return {
    orgId,
    context: () =>
      ({
        actorId: userId,
        organizationId: orgId,
        membershipId,
        requestId: randomUUID(),
        organizationWideLocationAccess: true,
        allowedLocationIds: new Set<string>(),
        permissions: new Set(["work_orders.read", "work_orders.write"] as const),
      }) as import("@/modules/tenancy/policy").TenantContext,
  };
}

describe("inventory (#161)", { skip: shouldSkip }, () => {
  it("creates items, adjusts stock, and rejects negative results", async () => {
    const { createItem, adjustStock, issueStock, listItems } =
      await import("@/modules/inventory/inventory-service");
    const seedData = await seed();

    const { itemId } = await createItem({
      db: dbModule.db,
      context: seedData.context(),
      partNumber: "PAD-101",
      name: "Ceramic front pad set",
      quantityOnHand: 4,
      reorderPoint: 2,
      unitCostMinor: 8200,
    });

    let result = await adjustStock({
      db: dbModule.db,
      context: seedData.context(),
      itemId,
      delta: 2,
      note: "Found an extra box",
    });
    expect(result.quantityOnHand).toBe(6);

    result = await issueStock({
      db: dbModule.db,
      context: seedData.context(),
      itemId,
      quantity: 5,
    });
    expect(result.quantityOnHand).toBe(1);

    await expect(
      issueStock({ db: dbModule.db, context: seedData.context(), itemId, quantity: 2 }),
    ).rejects.toMatchObject({ reason: "insufficient_stock" });

    const items = await listItems({ db: dbModule.db, context: seedData.context() });
    expect(items).toHaveLength(1);
    expect(items[0]?.quantityOnHand).toBe(1);
    expect(items[0]?.low).toBe(true); // 1 <= reorder point 2
  });

  it("receives into stock: upserts by part number and updates cost", async () => {
    const { receiveIntoStock, listItems } = await import("@/modules/inventory/inventory-service");
    const seedData = await seed();

    const first = await receiveIntoStock({
      db: dbModule.db,
      context: seedData.context(),
      partNumber: "ROT-220",
      name: "Front rotor pair",
      quantity: 2,
      unitCostMinor: 14100,
    });
    expect(first.quantityOnHand).toBe(2);

    const second = await receiveIntoStock({
      db: dbModule.db,
      context: seedData.context(),
      partNumber: "ROT-220",
      name: "Front rotor pair",
      quantity: 1,
      unitCostMinor: 15200,
    });
    expect(second.itemId).toBe(first.itemId);
    expect(second.quantityOnHand).toBe(3);

    const items = await listItems({ db: dbModule.db, context: seedData.context() });
    expect(items).toHaveLength(1);
    expect(items[0]?.quantityOnHand).toBe(3);
    expect(items[0]?.unitCostMinor).toBe("15200");
  });

  it("lowOnly lists just items at or below the reorder point", async () => {
    const { createItem, listItems } = await import("@/modules/inventory/inventory-service");
    const seedData = await seed();

    await createItem({
      db: dbModule.db,
      context: seedData.context(),
      partNumber: "LOW-1",
      name: "Low widget",
      quantityOnHand: 1,
      reorderPoint: 3,
    });
    await createItem({
      db: dbModule.db,
      context: seedData.context(),
      partNumber: "HIGH-1",
      name: "Plenty widget",
      quantityOnHand: 10,
      reorderPoint: 2,
    });

    const low = await listItems(
      { db: dbModule.db, context: seedData.context() },
      { lowOnly: true },
    );
    expect(low).toHaveLength(1);
    expect(low[0]?.partNumber).toBe("LOW-1");
  });

  it("rejects duplicates and keeps items tenant-scoped", async () => {
    const { createItem, adjustStock, listItems } =
      await import("@/modules/inventory/inventory-service");
    const seedA = await seed();
    const seedB = await seed();

    await createItem({
      db: dbModule.db,
      context: seedA.context(),
      partNumber: "SHARED-1",
      name: "Same number",
      quantityOnHand: 5,
    });
    // Same part number is legal in another org.
    await createItem({
      db: dbModule.db,
      context: seedB.context(),
      partNumber: "SHARED-1",
      name: "Same number",
      quantityOnHand: 1,
    });
    await expect(
      createItem({
        db: dbModule.db,
        context: seedA.context(),
        partNumber: "SHARED-1",
        name: "Same number",
      }),
    ).rejects.toMatchObject({ reason: "duplicate_part_number" });

    const itemB = await dbModule.db.inventoryItem.findFirst({
      where: { organizationId: seedB.orgId },
    });
    await expect(
      adjustStock({ db: dbModule.db, context: seedA.context(), itemId: itemB!.id, delta: 1 }),
    ).rejects.toMatchObject({ reason: "item_not_found" });

    const listA = await listItems({ db: dbModule.db, context: seedA.context() });
    expect(listA).toHaveLength(1);
  });
});
