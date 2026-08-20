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

async function seedOrderedOrder(lineSpec: {
  inventoryItemId?: string;
  quantity: number;
  alreadyReceived?: number;
}) {
  const orgId = randomUUID();
  const locationId = randomUUID();
  const userId = randomUUID();
  const supplierId = randomUUID();
  const itemId = lineSpec.inventoryItemId ?? randomUUID();

  await dbModule.db.$transaction([
    dbModule.db.organization.create({
      data: { id: orgId, slug: `org-${orgId.slice(0, 8)}`, name: "Receive Org" },
    }),
    dbModule.db.location.create({
      data: { id: locationId, organizationId: orgId, code: "MAIN", name: "Main", timeZone: "UTC" },
    }),
    dbModule.db.user.create({
      data: { id: userId, email: `rc-${userId.slice(0, 8)}@example.test`, displayName: "Receiver" },
    }),
    dbModule.db.partSupplier.create({
      data: { id: supplierId, organizationId: orgId, name: "Vendor" },
    }),
    dbModule.db.inventoryItem.create({
      data: {
        id: itemId,
        organizationId: orgId,
        locationId,
        partNumber: "OIL-QT",
        name: "Oil quart",
        quantityOnHand: 5,
      },
    }),
  ]);

  const { partOrderId } = await (
    await import("@/modules/parts/part-order-service")
  ).createPartOrder({
    db: dbModule.db,
    context: {
      actorId: userId,
      organizationId: orgId,
      membershipId: randomUUID(),
      requestId: randomUUID(),
      organizationWideLocationAccess: true,
      allowedLocationIds: new Set<string>(),
      permissions: new Set(["work_orders.write", "work_orders.read"]),
    } as import("@/modules/tenancy/policy").TenantContext,
    supplierId,
    purpose: "REPLENISH",
    lines: [
      {
        description: "Oil quart",
        partNumber: "OIL-QT",
        inventoryItemId: itemId,
        quantity: lineSpec.quantity,
        unitCostMinor: 500,
      },
    ],
  });

  const context = {
    actorId: userId,
    organizationId: orgId,
    membershipId: randomUUID(),
    requestId: randomUUID(),
    organizationWideLocationAccess: true,
    allowedLocationIds: new Set<string>(),
    permissions: new Set(["work_orders.write", "work_orders.read"]),
  } as import("@/modules/tenancy/policy").TenantContext;

  const parts = await import("@/modules/parts/part-order-service");
  await parts.markOrdered({ db: dbModule.db, context, partOrderId });
  if (lineSpec.alreadyReceived) {
    const line = await dbModule.db.partOrderLine.findFirst({ where: { partOrderId } });
    await dbModule.db.partOrderLine.update({
      where: { id: line!.id },
      data: { receivedQuantity: lineSpec.alreadyReceived },
    });
    await dbModule.db.inventoryItem.update({
      where: { id: itemId },
      data: { quantityOnHand: { increment: lineSpec.alreadyReceived } },
    });
  }

  return { context, partOrderId, itemId, orgId };
}

describe("receive-all (#217)", { skip: shouldSkip }, () => {
  it("fills every outstanding line, bumps linked stock, completes the order", async () => {
    const parts = await import("@/modules/parts/part-order-service");
    const seed = await seedOrderedOrder({ quantity: 10 });

    // Simulate the API's receive-all expansion: outstanding = 10 - 0.
    const line = await dbModule.db.partOrderLine.findFirst({
      where: { partOrderId: seed.partOrderId },
      select: { id: true, quantity: true, receivedQuantity: true },
    });
    const result = await parts.receiveItems({
      db: dbModule.db,
      context: seed.context,
      partOrderId: seed.partOrderId,
      lines: [{ lineId: line!.id, quantity: line!.quantity - line!.receivedQuantity }],
    });
    expect(result.orderCompleted).toBe(true);

    const item = await dbModule.db.inventoryItem.findUnique({
      where: { id: seed.itemId },
      select: { quantityOnHand: true },
    });
    expect(item?.quantityOnHand).toBe(15); // 5 + 10
  });

  it("receives only the remainder on partially received orders", async () => {
    const parts = await import("@/modules/parts/part-order-service");
    // 10 ordered, 4 already received → receive-all fills exactly 6.
    const seed = await seedOrderedOrder({ quantity: 10, alreadyReceived: 4 });

    const line = await dbModule.db.partOrderLine.findFirst({
      where: { partOrderId: seed.partOrderId },
      select: { id: true, quantity: true, receivedQuantity: true },
    });
    await parts.receiveItems({
      db: dbModule.db,
      context: seed.context,
      partOrderId: seed.partOrderId,
      lines: [{ lineId: line!.id, quantity: line!.quantity - line!.receivedQuantity }],
    });

    const item = await dbModule.db.inventoryItem.findUnique({
      where: { id: seed.itemId },
      select: { quantityOnHand: true },
    });
    expect(item?.quantityOnHand).toBe(15); // 5 + 4 + 6

    const order = await dbModule.db.partOrder.findUnique({
      where: { id: seed.partOrderId },
      select: { status: true, receivedAt: true },
    });
    expect(order?.status).toBe("RECEIVED");
    expect(order?.receivedAt).not.toBeNull();
  });
});
