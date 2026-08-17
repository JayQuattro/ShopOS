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
  const locationId = randomUUID();
  const userId = randomUUID();
  const membershipId = randomUUID();
  const roleId = randomUUID();
  const customerId = randomUUID();

  await dbModule.db.$transaction([
    dbModule.db.organization.create({
      data: { id: orgId, slug: `org-${orgId.slice(0, 8)}`, name: "Parts Org" },
    }),
    dbModule.db.location.create({
      data: { id: locationId, organizationId: orgId, code: "MAIN", name: "Main", timeZone: "UTC" },
    }),
    dbModule.db.user.create({
      data: {
        id: userId,
        email: `p-${userId.slice(0, 8)}@example.test`,
        displayName: "Parts User",
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
        displayName: "Parts Customer",
      },
    }),
    dbModule.db.workOrder.create({
      data: {
        organizationId: orgId,
        locationId,
        customerId,
        number: "RO-9801",
        customerConcern: "Needs parts",
        status: "IN_PROGRESS",
      },
    }),
  ]);

  const wo = await dbModule.db.workOrder.findFirst({ where: { organizationId: orgId } });

  return {
    orgId,
    workOrderId: wo!.id,
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

describe("parts ordering (#137, ADR 0015)", { skip: shouldSkip }, () => {
  it("manages suppliers with org-scoped unique names", async () => {
    const { createSupplier, listSuppliers } = await import("@/modules/parts/part-order-service");
    const seedData = await seed();

    await createSupplier({
      db: dbModule.db,
      context: seedData.context(),
      name: "NAPA",
      phone: "555-0100",
    });
    await expect(
      createSupplier({ db: dbModule.db, context: seedData.context(), name: "NAPA" }),
    ).rejects.toMatchObject({ reason: "duplicate_supplier_name" });

    const suppliers = await listSuppliers({ db: dbModule.db, context: seedData.context() });
    expect(suppliers.map((s) => s.name)).toEqual(["NAPA"]);
  });

  it("walks the order lifecycle: requested → ordered → received with partial receives", async () => {
    const { createSupplier, createPartOrder, listPartOrders, markOrdered, receiveItems } =
      await import("@/modules/parts/part-order-service");
    const seedData = await seed();
    const context = seedData.context();

    const { supplierId } = await createSupplier({ db: dbModule.db, context, name: "Worldpac" });
    const { partOrderId } = await createPartOrder({
      db: dbModule.db,
      context,
      workOrderId: seedData.workOrderId,
      supplierId,
      lines: [
        {
          description: "Front brake pads",
          partNumber: "PAD-101",
          quantity: 2,
          unitCostMinor: 4500,
        },
        { description: "Brake fluid", quantity: 1, unitCostMinor: 1200 },
      ],
    });

    let orders = await listPartOrders({
      db: dbModule.db,
      context,
      workOrderId: seedData.workOrderId,
    });
    expect(orders[0]?.status).toBe("REQUESTED");
    expect(orders[0]?.totalCostMinor).toBe("10200");
    expect(orders[0]?.currency).toBe("USD");
    expect(orders[0]?.source).toBe("MANUAL");

    await markOrdered({ db: dbModule.db, context, partOrderId, trackingNumber: "TRK-77" });

    // Partial receive: one of two pad sets, plus the fluid.
    const lineIds = orders[0]!.lines.map((line) => line.id);
    let receive = await receiveItems({
      db: dbModule.db,
      context,
      partOrderId,
      lines: [
        { lineId: lineIds[0]!, quantity: 1 },
        { lineId: lineIds[1]!, quantity: 1 },
      ],
    });
    expect(receive.orderCompleted).toBe(false);

    orders = await listPartOrders({ db: dbModule.db, context, workOrderId: seedData.workOrderId });
    expect(orders[0]?.status).toBe("ORDERED"); // still open until fully received

    receive = await receiveItems({
      db: dbModule.db,
      context,
      partOrderId,
      lines: [{ lineId: lineIds[0]!, quantity: 1 }],
    });
    expect(receive.orderCompleted).toBe(true);

    orders = await listPartOrders({ db: dbModule.db, context, workOrderId: seedData.workOrderId });
    expect(orders[0]?.status).toBe("RECEIVED");
    expect(orders[0]?.receivedAt).not.toBeNull();

    const activities = await dbModule.db.activityEvent.findMany({
      where: {
        workOrderId: seedData.workOrderId,
        eventType: { in: ["parts.requested", "parts.ordered", "parts.received"] },
      },
      orderBy: { occurredAt: "asc" },
    });
    expect(activities.map((a) => a.eventType)).toEqual([
      "parts.requested",
      "parts.ordered",
      "parts.received",
      "parts.received",
    ]);
    expect(activities[1]?.summary).toContain("TRK-77");
  });

  it("rejects over-receiving, invalid transitions, and bad lines", async () => {
    const { createSupplier, createPartOrder, markOrdered, receiveItems, cancelPartOrder } =
      await import("@/modules/parts/part-order-service");
    const seedData = await seed();
    const context = seedData.context();

    const { supplierId } = await createSupplier({ db: dbModule.db, context, name: "AutoZone" });

    await expect(
      createPartOrder({
        db: dbModule.db,
        context,
        workOrderId: seedData.workOrderId,
        supplierId,
        lines: [],
      }),
    ).rejects.toMatchObject({ reason: "invalid_lines" });
    await expect(
      createPartOrder({
        db: dbModule.db,
        context,
        workOrderId: seedData.workOrderId,
        supplierId,
        lines: [{ description: "Bad quantity", quantity: 0, unitCostMinor: 100 }],
      }),
    ).rejects.toMatchObject({ reason: "invalid_lines" });

    const { partOrderId } = await createPartOrder({
      db: dbModule.db,
      context,
      workOrderId: seedData.workOrderId,
      supplierId,
      lines: [{ description: "Wiper blades", quantity: 2, unitCostMinor: 1500 }],
    });

    // Cannot receive before ordering.
    const order = await dbModule.db.partOrder.findUniqueOrThrow({
      where: { id: partOrderId },
      include: { lines: true },
    });
    await expect(
      receiveItems({
        db: dbModule.db,
        context,
        partOrderId,
        lines: [{ lineId: order.lines[0]!.id, quantity: 1 }],
      }),
    ).rejects.toMatchObject({ reason: "invalid_transition" });

    await markOrdered({ db: dbModule.db, context, partOrderId });
    await expect(
      receiveItems({
        db: dbModule.db,
        context,
        partOrderId,
        lines: [{ lineId: order.lines[0]!.id, quantity: 3 }],
      }),
    ).rejects.toMatchObject({ reason: "invalid_receive_quantity" });

    await cancelPartOrder({ db: dbModule.db, context, partOrderId });
    await expect(markOrdered({ db: dbModule.db, context, partOrderId })).rejects.toMatchObject({
      reason: "invalid_transition",
    });
  });

  it("keeps suppliers and orders tenant-scoped", async () => {
    const { createSupplier, createPartOrder, listPartOrders, listSuppliers } =
      await import("@/modules/parts/part-order-service");
    const seedA = await seed();
    const seedB = await seed();

    const { supplierId: supplierA } = await createSupplier({
      db: dbModule.db,
      context: seedA.context(),
      name: "Shared Name",
    });

    // Org B cannot use org A's supplier or work order.
    await expect(
      createPartOrder({
        db: dbModule.db,
        context: seedB.context(),
        workOrderId: seedB.workOrderId,
        supplierId: supplierA,
        lines: [{ description: "Cross-org part", quantity: 1, unitCostMinor: 100 }],
      }),
    ).rejects.toMatchObject({ reason: "supplier_not_found" });
    await expect(
      createPartOrder({
        db: dbModule.db,
        context: seedA.context(),
        workOrderId: seedB.workOrderId,
        supplierId: supplierA,
        lines: [{ description: "Cross-org part", quantity: 1, unitCostMinor: 100 }],
      }),
    ).rejects.toMatchObject({ reason: "work_order_not_found" });

    // Same supplier name may exist in both orgs.
    await createSupplier({ db: dbModule.db, context: seedB.context(), name: "Shared Name" });
    const suppliersB = await listSuppliers({ db: dbModule.db, context: seedB.context() });
    expect(suppliersB).toHaveLength(1);

    const listed = await listPartOrders({
      db: dbModule.db,
      context: seedA.context(),
      workOrderId: seedA.workOrderId,
    });
    expect(listed).toHaveLength(0);
  });
});
