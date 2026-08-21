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
        email: `r-${userId.slice(0, 8)}@example.test`,
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
        permissions: ["work_orders.read", "work_orders.write", "authorizations.record"],
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
        permissions: new Set([
          "work_orders.read",
          "work_orders.write",
          "authorizations.record",
        ] as const),
      }) as import("@/modules/tenancy/policy").TenantContext,
  };
}

async function createWorkOrder(
  orgId: string,
  locationId: string,
  customerId: string,
  number: string,
) {
  return dbModule.db.workOrder.create({
    data: {
      organizationId: orgId,
      locationId,
      customerId,
      number,
      customerConcern: "test",
      status: "AWAITING_AUTHORIZATION",
    },
  });
}

async function createPresentedRevision(
  orgId: string,
  locationId: string,
  workOrderId: string,
  lineTotals: readonly bigint[],
) {
  const revision = await dbModule.db.estimateRevision.create({
    data: {
      organizationId: orgId,
      locationId,
      workOrderId,
      revisionNumber: 1,
      status: "PRESENTED",
      documentKind: "BASELINE",
      currency: "USD",
      subtotalMinor: 0n,
      discountMinor: 0n,
      taxMinor: 0n,
      totalMinor: 0n,
      presentedAt: new Date(),
    },
  });
  const lines = [];
  for (const [index, total] of lineTotals.entries()) {
    lines.push(
      await dbModule.db.estimateLine.create({
        data: {
          organizationId: orgId,
          estimateRevisionId: revision.id,
          serviceGroupKey: "general",
          kind: "PART",
          description: `line ${index + 1}`,
          quantityMilli: 1000,
          unitPriceMinor: total,
          grossMinor: total,
          discountMinor: 0n,
          taxable: false,
          taxRateBasisPoints: 0,
          taxMinor: 0n,
          totalMinor: total,
          position: index + 1,
        },
      }),
    );
  }
  return { revision, lines };
}

describe("inventory reservations (#236)", { skip: shouldSkip }, () => {
  it("holds stock without touching on-hand or the movement ledger", async () => {
    const { reserveStock, itemAvailability, listMovements } =
      await import("@/modules/inventory/inventory-service");
    const seed = await seedShop("Hold");
    const item = await dbModule.db.inventoryItem.create({
      data: {
        organizationId: seed.orgId,
        partNumber: "HOLD-1",
        name: "Held part",
        quantityOnHand: 4,
        unitCostMinor: 100n,
      },
    });
    const wo = await createWorkOrder(seed.orgId, seed.locationId, seed.customerId, "RO-3001");

    const result = await reserveStock({
      db: dbModule.db,
      context: seed.context(),
      itemId: item.id,
      workOrderId: wo.id,
      quantity: 3,
      note: "Pending estimate",
    });

    expect(result.available).toBe(1);
    const availability = await itemAvailability({
      db: dbModule.db,
      context: seed.context(),
      itemId: item.id,
    });
    expect(availability).toEqual({ onHand: 4, reserved: 3, available: 1 });

    const onHand = await dbModule.db.inventoryItem.findUnique({ where: { id: item.id } });
    expect(onHand?.quantityOnHand).toBe(4);
    const movements = await listMovements({
      db: dbModule.db,
      context: seed.context(),
      itemId: item.id,
    });
    expect(movements).toEqual([]);
  });

  it("refuses to hold beyond available stock and for a foreign work order", async () => {
    const { reserveStock } = await import("@/modules/inventory/inventory-service");
    const seedA = await seedShop("HoldA");
    const seedB = await seedShop("HoldB");
    const item = await dbModule.db.inventoryItem.create({
      data: {
        organizationId: seedA.orgId,
        partNumber: "HOLD-2",
        name: "Scarce part",
        quantityOnHand: 2,
        unitCostMinor: 100n,
      },
    });
    const woA = await createWorkOrder(seedA.orgId, seedA.locationId, seedA.customerId, "RO-3002");
    const woB = await createWorkOrder(seedB.orgId, seedB.locationId, seedB.customerId, "RO-3003");

    await reserveStock({
      db: dbModule.db,
      context: seedA.context(),
      itemId: item.id,
      workOrderId: woA.id,
      quantity: 2,
    });
    await expect(
      reserveStock({
        db: dbModule.db,
        context: seedA.context(),
        itemId: item.id,
        workOrderId: woA.id,
        quantity: 1,
      }),
    ).rejects.toMatchObject({ reason: "insufficient_stock" });
    await expect(
      reserveStock({
        db: dbModule.db,
        context: seedA.context(),
        itemId: item.id,
        workOrderId: woB.id,
        quantity: 1,
      }),
    ).rejects.toMatchObject({ reason: "work_order_not_found" });
  });

  it("releases the hold for a declined estimate line, and every hold when the estimate is fully rejected", async () => {
    const { reserveStock, itemAvailability } =
      await import("@/modules/inventory/inventory-service");
    const { recordAuthorization } = await import("@/modules/estimates/authorization-service");
    const seed = await seedShop("Decline");
    const item = await dbModule.db.inventoryItem.create({
      data: {
        organizationId: seed.orgId,
        partNumber: "DEC-1",
        name: "Declineable part",
        quantityOnHand: 5,
        unitCostMinor: 100n,
      },
    });
    const itemUnlinked = await dbModule.db.inventoryItem.create({
      data: {
        organizationId: seed.orgId,
        partNumber: "DEC-2",
        name: "Unlinked part",
        quantityOnHand: 5,
        unitCostMinor: 100n,
      },
    });
    const wo = await createWorkOrder(seed.orgId, seed.locationId, seed.customerId, "RO-3004");
    const { revision, lines } = await createPresentedRevision(seed.orgId, seed.locationId, wo.id, [
      5000n,
      5000n,
    ]);

    await reserveStock({
      db: dbModule.db,
      context: seed.context(),
      itemId: item.id,
      workOrderId: wo.id,
      quantity: 2,
      estimateLineId: lines[0]!.id,
    });
    await reserveStock({
      db: dbModule.db,
      context: seed.context(),
      itemId: itemUnlinked.id,
      workOrderId: wo.id,
      quantity: 1,
    });

    // Decline only the first line: its hold releases, the unlinked hold stays.
    await recordAuthorization({
      db: dbModule.db,
      context: seed.context(),
      revisionId: revision.id,
      method: "CUSTOMER_LINK",
      providedByName: "Customer",
      decisions: [{ estimateLineId: lines[0]!.id, decision: "DECLINED" }],
    });
    expect(
      (await itemAvailability({ db: dbModule.db, context: seed.context(), itemId: item.id }))
        .reserved,
    ).toBe(0);
    expect(
      (
        await itemAvailability({
          db: dbModule.db,
          context: seed.context(),
          itemId: itemUnlinked.id,
        })
      ).reserved,
    ).toBe(1);

    // Decline the remaining line: full rejection releases everything.
    await recordAuthorization({
      db: dbModule.db,
      context: seed.context(),
      revisionId: revision.id,
      method: "CUSTOMER_LINK",
      providedByName: "Customer",
      decisions: [{ estimateLineId: lines[1]!.id, decision: "DECLINED" }],
    });
    expect(
      (
        await itemAvailability({
          db: dbModule.db,
          context: seed.context(),
          itemId: itemUnlinked.id,
        })
      ).reserved,
    ).toBe(0);
  });

  it("releases line-linked holds when a revision is superseded", async () => {
    const { reserveStock, itemAvailability } =
      await import("@/modules/inventory/inventory-service");
    const { supersedeRevision } = await import("@/modules/estimates/estimate-service");
    const seed = await seedShop("Supersede");
    const item = await dbModule.db.inventoryItem.create({
      data: {
        organizationId: seed.orgId,
        partNumber: "SUP-1",
        name: "Superseded part",
        quantityOnHand: 5,
        unitCostMinor: 100n,
      },
    });
    const wo = await createWorkOrder(seed.orgId, seed.locationId, seed.customerId, "RO-3005");
    const { revision, lines } = await createPresentedRevision(seed.orgId, seed.locationId, wo.id, [
      5000n,
    ]);

    await reserveStock({
      db: dbModule.db,
      context: seed.context(),
      itemId: item.id,
      workOrderId: wo.id,
      quantity: 2,
      estimateLineId: lines[0]!.id,
    });
    await supersedeRevision({ db: dbModule.db, context: seed.context(), revisionId: revision.id });

    expect(
      (await itemAvailability({ db: dbModule.db, context: seed.context(), itemId: item.id }))
        .reserved,
    ).toBe(0);
  });

  it("releases every hold when the work order is cancelled", async () => {
    const { reserveStock, itemAvailability } =
      await import("@/modules/inventory/inventory-service");
    const { transitionStatus } = await import("@/modules/work-orders/work-order-service");
    const seed = await seedShop("Cancel");
    const item = await dbModule.db.inventoryItem.create({
      data: {
        organizationId: seed.orgId,
        partNumber: "CXL-1",
        name: "Cancelled part",
        quantityOnHand: 5,
        unitCostMinor: 100n,
      },
    });
    const wo = await createWorkOrder(seed.orgId, seed.locationId, seed.customerId, "RO-3006");
    await reserveStock({
      db: dbModule.db,
      context: seed.context(),
      itemId: item.id,
      workOrderId: wo.id,
      quantity: 2,
    });

    await transitionStatus({
      db: dbModule.db,
      context: seed.context(),
      workOrderId: wo.id,
      targetStatus: "CANCELLED",
    });

    expect(
      (await itemAvailability({ db: dbModule.db, context: seed.context(), itemId: item.id }))
        .reserved,
    ).toBe(0);
  });

  it("issues held parts to the job: on-hand drops, movements written, idempotent", async () => {
    const { reserveStock, issueReservationsForWorkOrder, itemAvailability, listMovements } =
      await import("@/modules/inventory/inventory-service");
    const seed = await seedShop("Issue");
    const item = await dbModule.db.inventoryItem.create({
      data: {
        organizationId: seed.orgId,
        partNumber: "ISS-1",
        name: "Issued part",
        quantityOnHand: 5,
        unitCostMinor: 100n,
      },
    });
    const wo = await createWorkOrder(seed.orgId, seed.locationId, seed.customerId, "RO-3007");
    await reserveStock({
      db: dbModule.db,
      context: seed.context(),
      itemId: item.id,
      workOrderId: wo.id,
      quantity: 2,
      note: "approved job",
    });

    const result = await issueReservationsForWorkOrder({
      db: dbModule.db,
      context: seed.context(),
      workOrderId: wo.id,
    });
    expect(result.issued).toBe(1);

    const availability = await itemAvailability({
      db: dbModule.db,
      context: seed.context(),
      itemId: item.id,
    });
    expect(availability).toEqual({ onHand: 3, reserved: 0, available: 3 });

    const movements = await listMovements({
      db: dbModule.db,
      context: seed.context(),
      itemId: item.id,
    });
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({
      delta: -2,
      reason: "ISSUED_TO_JOB",
      workOrderNumber: "RO-3007",
    });

    const again = await issueReservationsForWorkOrder({
      db: dbModule.db,
      context: seed.context(),
      workOrderId: wo.id,
    });
    expect(again.issued).toBe(0);
  });

  it("keeps another organization from reading holds", async () => {
    const { reserveStock, listReservations } =
      await import("@/modules/inventory/inventory-service");
    const seedA = await seedShop("ReadA");
    const seedB = await seedShop("ReadB");
    const item = await dbModule.db.inventoryItem.create({
      data: {
        organizationId: seedA.orgId,
        partNumber: "SEC-2",
        name: "Hidden part",
        quantityOnHand: 5,
        unitCostMinor: 100n,
      },
    });
    const wo = await createWorkOrder(seedA.orgId, seedA.locationId, seedA.customerId, "RO-3008");
    await reserveStock({
      db: dbModule.db,
      context: seedA.context(),
      itemId: item.id,
      workOrderId: wo.id,
      quantity: 1,
    });

    const foreign = await listReservations({
      db: dbModule.db,
      context: seedB.context(),
      itemId: item.id,
    });
    expect(foreign).toEqual([]);
  });
});
