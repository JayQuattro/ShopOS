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
  const supplierA = randomUUID();
  const supplierB = randomUUID();
  const oilQuart = randomUUID();
  const oilGallon = randomUUID();

  await dbModule.db.$transaction([
    dbModule.db.organization.create({
      data: { id: orgId, slug: `org-${orgId.slice(0, 8)}`, name: "Tracking Org" },
    }),
    dbModule.db.location.create({
      data: { id: locationId, organizationId: orgId, code: "MAIN", name: "Main", timeZone: "UTC" },
    }),
    dbModule.db.user.create({
      data: {
        id: userId,
        email: `tr-${userId.slice(0, 8)}@example.test`,
        displayName: "Parts Desk",
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
        permissions: ["work_orders.write", "work_orders.read", "assets.write"],
      },
    }),
    dbModule.db.membershipRole.create({ data: { organizationId: orgId, membershipId, roleId } }),
    dbModule.db.customer.create({
      data: { id: customerId, organizationId: orgId, kind: "INDIVIDUAL", displayName: "Customer" },
    }),
    dbModule.db.partSupplier.create({
      data: { id: supplierA, organizationId: orgId, name: "Worldpac" },
    }),
    dbModule.db.partSupplier.create({
      data: { id: supplierB, organizationId: orgId, name: "NAPA" },
    }),
    dbModule.db.inventoryItem.create({
      data: {
        id: oilQuart,
        organizationId: orgId,
        locationId,
        partNumber: "OIL-5W30-QT",
        name: "Oil 5W-30 (quart)",
        uomGroup: "volume",
        unitOfMeasure: "quart",
        uomFactorMilli: 1000,
        quantityOnHand: 4,
      },
    }),
    dbModule.db.inventoryItem.create({
      data: {
        id: oilGallon,
        organizationId: orgId,
        locationId,
        partNumber: "OIL-5W30-GAL",
        name: "Oil 5W-30 (gallon)",
        uomGroup: "volume",
        unitOfMeasure: "gallon",
        uomFactorMilli: 4000,
        quantityOnHand: 2,
      },
    }),
  ]);

  const context = () =>
    ({
      actorId: userId,
      organizationId: orgId,
      membershipId,
      requestId: randomUUID(),
      organizationWideLocationAccess: true,
      allowedLocationIds: new Set<string>(),
      permissions: new Set(["work_orders.write", "work_orders.read", "assets.write"]),
    }) as import("@/modules/tenancy/policy").TenantContext;

  return { orgId, locationId, supplierA, supplierB, oilQuart, oilGallon, context };
}

describe("order purpose + systematic receiving (#216)", { skip: shouldSkip }, () => {
  it("creates stock replenishment orders without a work order and receives into stock", async () => {
    const parts = await import("@/modules/parts/part-order-service");
    const seed = await seedShop();

    // A stock replenishment order — no job.
    const { partOrderId } = await parts.createPartOrder({
      db: dbModule.db,
      context: seed.context(),
      supplierId: seed.supplierA,
      purpose: "REPLENISH",
      lines: [
        {
          description: "Oil 5W-30 (quart)",
          partNumber: "OIL-5W30-QT",
          inventoryItemId: seed.oilQuart,
          quantity: 12,
          unitCostMinor: 549,
        },
      ],
    });

    // JOB purpose without a work order is refused.
    await expect(
      parts.createPartOrder({
        db: dbModule.db,
        context: seed.context(),
        supplierId: seed.supplierA,
        purpose: "JOB",
        lines: [{ description: "Something", quantity: 1, unitCostMinor: 100 }],
      }),
    ).rejects.toMatchObject({ reason: "invalid_lines" });

    await parts.markOrdered({ db: dbModule.db, context: seed.context(), partOrderId });

    // Receiving bumps the linked item automatically — systematic.
    await parts.receiveItems({
      db: dbModule.db,
      context: seed.context(),
      partOrderId,
      lines: [
        {
          lineId: (await dbModule.db.partOrderLine.findFirst({ where: { partOrderId } }))!.id,
          quantity: 12,
        },
      ],
    });

    const item = await dbModule.db.inventoryItem.findUnique({
      where: { id: seed.oilQuart },
      select: { quantityOnHand: true },
    });
    expect(item?.quantityOnHand).toBe(16); // 4 + 12 received
  });

  it("groups waiting orders by vendor with purpose and progress", async () => {
    const parts = await import("@/modules/parts/part-order-service");
    const seed = await seedShop();

    // Two vendors waiting, one order each.
    await parts.createPartOrder({
      db: dbModule.db,
      context: seed.context(),
      supplierId: seed.supplierA,
      purpose: "REPLENISH",
      lines: [
        {
          description: "Pads",
          partNumber: "BRK-1",
          inventoryItemId: seed.oilQuart,
          quantity: 4,
          unitCostMinor: 4000,
        },
      ],
    });
    await parts.createPartOrder({
      db: dbModule.db,
      context: seed.context(),
      supplierId: seed.supplierB,
      purpose: "REPLENISH",
      lines: [{ description: "Rotor", quantity: 2, unitCostMinor: 6000 }],
    });

    const groups = await parts.listWaitingByVendor({ db: dbModule.db, context: seed.context() });
    expect(groups.map((group) => group.supplierName).sort()).toEqual(["NAPA", "Worldpac"]);
    const worldpac = groups.find((group) => group.supplierName === "Worldpac")!;
    expect(worldpac.orders[0]?.purpose).toBe("REPLENISH");
    expect(worldpac.orders[0]?.lines[0]?.receivedQuantity).toBe(0);

    // Received orders leave the waiting board.
    const order = await dbModule.db.partOrder.findFirst({
      where: { supplierId: seed.supplierB },
      select: { id: true },
    });
    await parts.markOrdered({ db: dbModule.db, context: seed.context(), partOrderId: order!.id });
    await parts.receiveItems({
      db: dbModule.db,
      context: seed.context(),
      partOrderId: order!.id,
      lines: [
        {
          lineId: (await dbModule.db.partOrderLine.findFirst({
            where: { partOrderId: order!.id },
          }))!.id,
          quantity: 2,
        },
      ],
    });
    const after = await parts.listWaitingByVendor({ db: dbModule.db, context: seed.context() });
    expect(after.map((group) => group.supplierName)).toEqual(["Worldpac"]);
  });

  it("surfaces purchase history per item via link and part-number fallback", async () => {
    const parts = await import("@/modules/parts/part-order-service");
    const seed = await seedShop();

    // Old-style order: no link, matching part number only.
    const legacy = await parts.createPartOrder({
      db: dbModule.db,
      context: seed.context(),
      supplierId: seed.supplierA,
      purpose: "REPLENISH",
      lines: [
        {
          description: "Oil 5W-30 (quart)",
          partNumber: "OIL-5W30-QT",
          quantity: 6,
          unitCostMinor: 529,
        },
      ],
    });
    await parts.markOrdered({
      db: dbModule.db,
      context: seed.context(),
      partOrderId: legacy.partOrderId,
    });

    // New-style: explicit link, different supplier.
    const linked = await parts.createPartOrder({
      db: dbModule.db,
      context: seed.context(),
      supplierId: seed.supplierB,
      purpose: "REPLENISH",
      lines: [
        {
          description: "Oil 5W-30 (quart)",
          inventoryItemId: seed.oilQuart,
          quantity: 3,
          unitCostMinor: 599,
        },
      ],
    });
    await parts.markOrdered({
      db: dbModule.db,
      context: seed.context(),
      partOrderId: linked.partOrderId,
    });

    const history = await parts.listPurchaseHistory({
      db: dbModule.db,
      context: seed.context(),
      inventoryItemId: seed.oilQuart,
    });
    expect(history).toHaveLength(2);
    // Most recent first — the linked NAPA order.
    expect(history[0]?.supplierName).toBe("NAPA");
    expect(history[0]?.quantity).toBe(3);
    expect(history[1]?.supplierName).toBe("Worldpac");
    expect(history[1]?.quantity).toBe(6);
  });

  it("totals stock in base units per UoM group across containers", async () => {
    const inventory = await import("@/modules/inventory/inventory-service");
    const seed = await seedShop();

    const groups = await inventory.uomSummary({ db: dbModule.db, context: seed.context() });
    expect(groups).toHaveLength(1);
    const volume = groups[0]!;
    expect(volume.group).toBe("volume");
    // 4 quarts + 2 gallons (×4) = 12 quarts.
    expect(volume.totalBaseUnits).toBe(12);
    expect(volume.containers).toHaveLength(2);
  });
});
