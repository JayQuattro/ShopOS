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
  const locationId = randomUUID();
  const userId = randomUUID();
  const membershipId = randomUUID();
  const roleId = randomUUID();
  const customerId = randomUUID();
  const workOrderId = randomUUID();

  await dbModule.db.$transaction([
    dbModule.db.organization.create({
      data: { id: orgId, slug: `org-${orgId.slice(0, 8)}`, name: "Reorder Org" },
    }),
    dbModule.db.location.create({
      data: { id: locationId, organizationId: orgId, code: "MAIN", name: "Main", timeZone: "UTC" },
    }),
    dbModule.db.user.create({
      data: {
        id: userId,
        email: `ro-${userId.slice(0, 8)}@example.test`,
        displayName: "Reorder User",
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
        permissions: ["work_orders.read", "work_orders.write"],
      },
    }),
    dbModule.db.membershipRole.create({ data: { organizationId: orgId, membershipId, roleId } }),
    dbModule.db.customer.create({
      data: {
        id: customerId,
        organizationId: orgId,
        kind: "INDIVIDUAL",
        displayName: "Reorder Customer",
      },
    }),
    dbModule.db.workOrder.create({
      data: {
        id: workOrderId,
        organizationId: orgId,
        locationId,
        customerId,
        number: "RO-2101",
        customerConcern: "Reorder host",
        status: "DRAFT",
      },
    }),
  ]);

  return {
    orgId,
    locationId,
    workOrderId,
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

describe("auto-reorder (#171)", { skip: shouldSkip }, () => {
  it("suggests low-stock items with quantities and inferred supplier", async () => {
    const { createItem } = await import("@/modules/inventory/inventory-service");
    const { listReorderSuggestions } = await import("@/modules/inventory/inventory-service");
    const seedData = await seedShop();
    const context = seedData.context();

    await createItem({
      db: dbModule.db,
      context,
      partNumber: "PAD-101",
      name: "Ceramic front pad set",
      quantityOnHand: 1,
      reorderPoint: 4,
      unitCostMinor: 8200,
    });
    await createItem({
      db: dbModule.db,
      context,
      partNumber: "OK-1",
      name: "Stocked fine",
      quantityOnHand: 10,
      reorderPoint: 2,
      unitCostMinor: 500,
    });

    // Purchase history for PAD-101 from Worldpac.
    const supplier = await dbModule.db.partSupplier.create({
      data: {
        id: randomUUID(),
        organizationId: seedData.orgId,
        name: "Worldpac Carolina",
      },
    });
    const historyOrder = await dbModule.db.partOrder.create({
      data: {
        id: randomUUID(),
        organizationId: seedData.orgId,
        locationId: seedData.locationId,
        workOrderId: seedData.workOrderId,
        supplierId: supplier.id,
        status: "RECEIVED",
        source: "MANUAL",
        currency: "USD",
        orderedAt: new Date(Date.now() - 48 * 3_600_000),
        receivedAt: new Date(Date.now() - 24 * 3_600_000),
      },
    });
    await dbModule.db.partOrderLine.create({
      data: {
        id: randomUUID(),
        organizationId: seedData.orgId,
        partOrderId: historyOrder.id,
        description: "Ceramic front pad set",
        partNumber: "PAD-101",
        quantity: 4,
        receivedQuantity: 4,
        unitCostMinor: 8200n,
      },
    });

    const suggestions = await listReorderSuggestions({ db: dbModule.db, context });
    expect(suggestions).toHaveLength(1); // only the low item
    expect(suggestions[0]?.partNumber).toBe("PAD-101");
    expect(suggestions[0]?.suggestedQuantity).toBe(3); // 4 - 1
    expect(suggestions[0]?.supplierName).toBe("Worldpac Carolina");
  });

  it("creates a REQUESTED part order from suggestions at current costs", async () => {
    const { createItem, listReorderSuggestions, createReorderFromSuggestions } =
      await import("@/modules/inventory/inventory-service");
    const seedData = await seedShop();
    const context = seedData.context();

    const { itemId } = await createItem({
      db: dbModule.db,
      context,
      partNumber: "WIP-9",
      name: "Wiper blades",
      quantityOnHand: 0,
      reorderPoint: 6,
      unitCostMinor: 1200,
    });
    const supplier = await dbModule.db.partSupplier.create({
      data: { id: randomUUID(), organizationId: seedData.orgId, name: "NAPA" },
    });
    const historyOrder = await dbModule.db.partOrder.create({
      data: {
        id: randomUUID(),
        organizationId: seedData.orgId,
        locationId: seedData.locationId,
        workOrderId: seedData.workOrderId,
        supplierId: supplier.id,
        status: "RECEIVED",
        source: "MANUAL",
        currency: "USD",
        orderedAt: new Date(Date.now() - 48 * 3_600_000),
        receivedAt: new Date(Date.now() - 24 * 3_600_000),
      },
    });
    await dbModule.db.partOrderLine.create({
      data: {
        id: randomUUID(),
        organizationId: seedData.orgId,
        partOrderId: historyOrder.id,
        description: "Wiper blades",
        partNumber: "WIP-9",
        quantity: 6,
        receivedQuantity: 6,
        unitCostMinor: 1100n,
      },
    });

    const suggestions = await listReorderSuggestions({ db: dbModule.db, context });
    expect(suggestions[0]?.supplierId).toBe(supplier.id);

    const result = await createReorderFromSuggestions({
      db: dbModule.db,
      context,
      workOrderId: seedData.workOrderId,
      itemIds: [itemId],
    });

    const order = await dbModule.db.partOrder.findUnique({
      where: { id: result.partOrderId },
      include: { lines: true, supplier: true },
    });
    expect(order?.status).toBe("REQUESTED");
    expect(order?.supplier.name).toBe("NAPA");
    expect(order?.lines).toHaveLength(1);
    expect(order?.lines[0]?.partNumber).toBe("WIP-9");
    expect(order?.lines[0]?.quantity).toBe(6); // reorder point - 0
    expect(order?.lines[0]?.unitCostMinor).toBe(1200n); // current shelf cost
  });

  it("refuses reorder without any supplier and keeps tenant scope", async () => {
    const { createItem, createReorderFromSuggestions } =
      await import("@/modules/inventory/inventory-service");
    const seedA = await seedShop();
    const seedB = await seedShop();
    const context = seedA.context();

    const { itemId } = await createItem({
      db: dbModule.db,
      context,
      partNumber: "NO-SUP",
      name: "Never ordered",
      quantityOnHand: 0,
      reorderPoint: 2,
      unitCostMinor: 100,
    });

    await expect(
      createReorderFromSuggestions({
        db: dbModule.db,
        context,
        workOrderId: seedA.workOrderId,
        itemIds: [itemId],
      }),
    ).rejects.toMatchObject({ reason: "supplier_not_found" });

    await expect(
      createReorderFromSuggestions({
        db: dbModule.db,
        context: seedB.context(),
        workOrderId: seedA.workOrderId,
        itemIds: [itemId],
      }),
    ).rejects.toMatchObject({ reason: "work_order_not_found" });
  });
});
