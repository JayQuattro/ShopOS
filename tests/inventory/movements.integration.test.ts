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

async function seedShop(name: string) {
  const orgId = randomUUID();
  const locationId = randomUUID();
  const userId = randomUUID();
  const membershipId = randomUUID();
  const roleId = randomUUID();
  const customerId = randomUUID();

  await dbModule.db.$transaction([
    dbModule.db.organization.create({
      data: { id: orgId, slug: `org-${orgId.slice(0, 8)}`, name, defaultCurrency: "USD" },
    }),
    dbModule.db.location.create({
      data: { id: locationId, organizationId: orgId, code: "MAIN", name: "Main", timeZone: "UTC" },
    }),
    dbModule.db.user.create({
      data: {
        id: userId,
        email: `m-${userId.slice(0, 8)}@example.test`,
        displayName: `${name} User`,
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
        displayName: `${name} Customer`,
      },
    }),
  ]);

  return {
    orgId,
    locationId,
    userId,
    customerId,
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

describe("inventory movements (#235)", { skip: shouldSkip }, () => {
  it("records a ledger row for every manual adjustment, up and down", async () => {
    const { adjustStock, listMovements } = await import("@/modules/inventory/inventory-service");
    const seed = await seedShop("Adjust");
    const item = await dbModule.db.inventoryItem.create({
      data: {
        organizationId: seed.orgId,
        partNumber: "PAD-100",
        name: "Brake pads",
        quantityOnHand: 10,
        unitCostMinor: 4000n,
      },
    });

    await adjustStock({
      db: dbModule.db,
      context: seed.context(),
      itemId: item.id,
      delta: 2,
      note: "Found on shelf",
    });
    await adjustStock({
      db: dbModule.db,
      context: seed.context(),
      itemId: item.id,
      delta: -3,
      note: "Cycle count correction",
    });

    const movements = await listMovements({
      db: dbModule.db,
      context: seed.context(),
      itemId: item.id,
    });
    expect(movements).toHaveLength(2);
    expect(movements[0]!.delta).toBe(-3);
    expect(movements[0]!.reason).toBe("MANUAL_ADJUSTMENT");
    expect(movements[0]!.note).toBe("Cycle count correction");
    expect(movements[0]!.createdByName).toBe("Adjust User");
    expect(movements[1]!.delta).toBe(2);
    expect(movements[1]!.reason).toBe("RETURNED_TO_STOCK");
    const onHand = await dbModule.db.inventoryItem.findUnique({ where: { id: item.id } });
    expect(onHand?.quantityOnHand).toBe(9);
  });

  it("records RECEIVED with work-order lineage when receiving into stock from a job", async () => {
    const { receiveIntoStock, listMovements } =
      await import("@/modules/inventory/inventory-service");
    const seed = await seedShop("Receive");
    const wo = await dbModule.db.workOrder.create({
      data: {
        organizationId: seed.orgId,
        locationId: seed.locationId,
        customerId: seed.customerId,
        number: "RO-2001",
        customerConcern: "squeal",
        status: "IN_PROGRESS",
      },
    });

    const result = await receiveIntoStock({
      db: dbModule.db,
      context: seed.context(),
      partNumber: "ROT-220",
      name: "Rotor",
      quantity: 2,
      unitCostMinor: 6500,
      workOrderId: wo.id,
    });

    const movements = await listMovements({
      db: dbModule.db,
      context: seed.context(),
      itemId: result.itemId,
    });
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({
      delta: 2,
      reason: "RECEIVED",
      workOrderNumber: "RO-2001",
    });
  });

  it("rejects a work order from another organization on receive-into-stock", async () => {
    const { receiveIntoStock } = await import("@/modules/inventory/inventory-service");
    const seedA = await seedShop("ReceiveA");
    const seedB = await seedShop("ReceiveB");
    const foreignWo = await dbModule.db.workOrder.create({
      data: {
        organizationId: seedB.orgId,
        locationId: seedB.locationId,
        customerId: seedB.customerId,
        number: "RO-2002",
        customerConcern: "foreign",
        status: "IN_PROGRESS",
      },
    });

    await expect(
      receiveIntoStock({
        db: dbModule.db,
        context: seedA.context(),
        partNumber: "X-1",
        name: "Cross org part",
        quantity: 1,
        unitCostMinor: 100,
        workOrderId: foreignWo.id,
      }),
    ).rejects.toMatchObject({ reason: "item_not_found" });
  });

  it("issues stock to a job with lineage and refuses over-issue", async () => {
    const { issueStock, listMovements } = await import("@/modules/inventory/inventory-service");
    const seed = await seedShop("Issue");
    const item = await dbModule.db.inventoryItem.create({
      data: {
        organizationId: seed.orgId,
        partNumber: "OIL-5W30",
        name: "Synthetic oil 5W-30",
        quantityOnHand: 6,
        unitCostMinor: 900n,
      },
    });
    const wo = await dbModule.db.workOrder.create({
      data: {
        organizationId: seed.orgId,
        locationId: seed.locationId,
        customerId: seed.customerId,
        number: "RO-2003",
        customerConcern: "oil change",
        status: "IN_PROGRESS",
      },
    });

    const result = await issueStock({
      db: dbModule.db,
      context: seed.context(),
      itemId: item.id,
      quantity: 5,
      workOrderId: wo.id,
      note: "Oil change",
    });
    expect(result.quantityOnHand).toBe(1);

    await expect(
      issueStock({
        db: dbModule.db,
        context: seed.context(),
        itemId: item.id,
        quantity: 2,
        workOrderId: wo.id,
      }),
    ).rejects.toMatchObject({ reason: "insufficient_stock" });

    const movements = await listMovements({
      db: dbModule.db,
      context: seed.context(),
      itemId: item.id,
    });
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({
      delta: -5,
      reason: "ISSUED_TO_JOB",
      workOrderNumber: "RO-2003",
    });
  });

  it("writes RECEIVED movements when a linked part-order line is received", async () => {
    const { receiveItems } = await import("@/modules/parts/part-order-service");
    const { listMovements } = await import("@/modules/inventory/inventory-service");
    const seed = await seedShop("OrderRecv");
    const item = await dbModule.db.inventoryItem.create({
      data: {
        organizationId: seed.orgId,
        partNumber: "FLT-9",
        name: "Oil filter",
        quantityOnHand: 0,
        unitCostMinor: 500n,
      },
    });
    const wo = await dbModule.db.workOrder.create({
      data: {
        organizationId: seed.orgId,
        locationId: seed.locationId,
        customerId: seed.customerId,
        number: "RO-2004",
        customerConcern: "service",
        status: "IN_PROGRESS",
      },
    });
    const supplier = await dbModule.db.partSupplier.create({
      data: { organizationId: seed.orgId, name: "NAPA" },
    });
    const order = await dbModule.db.partOrder.create({
      data: {
        organizationId: seed.orgId,
        locationId: seed.locationId,
        workOrderId: wo.id,
        supplierId: supplier.id,
        status: "ORDERED",
        currency: "USD",
        createdByUserId: seed.userId,
      },
    });
    const line = await dbModule.db.partOrderLine.create({
      data: {
        organizationId: seed.orgId,
        partOrderId: order.id,
        description: "Oil filter",
        partNumber: "FLT-9",
        inventoryItemId: item.id,
        quantity: 4,
        unitCostMinor: 500n,
      },
    });

    const result = await receiveItems({
      db: dbModule.db,
      context: seed.context(),
      partOrderId: order.id,
      lines: [{ lineId: line.id, quantity: 3 }],
    });
    expect(result.orderCompleted).toBe(false);

    const onHand = await dbModule.db.inventoryItem.findUnique({ where: { id: item.id } });
    expect(onHand?.quantityOnHand).toBe(3);

    const movements = await listMovements({
      db: dbModule.db,
      context: seed.context(),
      itemId: item.id,
    });
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({
      delta: 3,
      reason: "RECEIVED",
      workOrderNumber: "RO-2004",
    });
    expect(movements[0]!.note).toContain("NAPA");
  });

  it("never lets another organization read an item's movements", async () => {
    const { adjustStock, listMovements } = await import("@/modules/inventory/inventory-service");
    const seedA = await seedShop("OwnOrg");
    const seedB = await seedShop("ReadOrg");
    const item = await dbModule.db.inventoryItem.create({
      data: {
        organizationId: seedA.orgId,
        partNumber: "SEC-1",
        name: "Secret part",
        quantityOnHand: 5,
        unitCostMinor: 100n,
      },
    });
    await adjustStock({ db: dbModule.db, context: seedA.context(), itemId: item.id, delta: 1 });

    const foreign = await listMovements({
      db: dbModule.db,
      context: seedB.context(),
      itemId: item.id,
    });
    expect(foreign).toEqual([]);
  });

  it("keeps the ledger append-only at the database level", async () => {
    const { adjustStock } = await import("@/modules/inventory/inventory-service");
    const seed = await seedShop("Immutable");
    const item = await dbModule.db.inventoryItem.create({
      data: {
        organizationId: seed.orgId,
        partNumber: "LED-1",
        name: "Ledger part",
        quantityOnHand: 5,
        unitCostMinor: 100n,
      },
    });
    await adjustStock({ db: dbModule.db, context: seed.context(), itemId: item.id, delta: 1 });
    const movement = await dbModule.db.inventoryMovement.findFirst({
      where: { organizationId: seed.orgId },
    });
    expect(movement).not.toBeNull();

    await expect(
      dbModule.db.inventoryMovement.update({
        where: { id: movement!.id },
        data: { delta: 99 },
      }),
    ).rejects.toThrow();

    await expect(
      dbModule.db.inventoryMovement.delete({ where: { id: movement!.id } }),
    ).rejects.toThrow();
  });
});
