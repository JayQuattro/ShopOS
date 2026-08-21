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
        email: `c-${userId.slice(0, 8)}@example.test`,
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
        permissions: [
          "work_orders.read",
          "work_orders.write",
          "authorizations.record",
          "invoices.issue",
        ],
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
          "invoices.issue",
        ] as const),
      }) as import("@/modules/tenancy/policy").TenantContext,
  };
}

/** Presented revision with a linked approved PART line; returns the line. */
async function presentedApprovedLinkedLine(opts: {
  orgId: string;
  locationId: string;
  customerId: string;
  userId: string;
  context: import("@/modules/tenancy/policy").TenantContext;
  itemId: string | null;
  quantityMilli: number;
  workOrderNumber: string;
}) {
  const { recordAuthorization } = await import("@/modules/estimates/authorization-service");
  const wo = await dbModule.db.workOrder.create({
    data: {
      organizationId: opts.orgId,
      locationId: opts.locationId,
      customerId: opts.customerId,
      number: opts.workOrderNumber,
      customerConcern: "consume",
      status: "AWAITING_AUTHORIZATION",
    },
  });
  const revision = await dbModule.db.estimateRevision.create({
    data: {
      organizationId: opts.orgId,
      locationId: opts.locationId,
      workOrderId: wo.id,
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
  const total = 5000n;
  const line = await dbModule.db.estimateLine.create({
    data: {
      organizationId: opts.orgId,
      estimateRevisionId: revision.id,
      serviceGroupKey: "general",
      kind: "PART",
      description: "linked part",
      quantityMilli: opts.quantityMilli,
      unitPriceMinor: total,
      grossMinor: total,
      discountMinor: 0n,
      taxable: false,
      taxRateBasisPoints: 0,
      taxMinor: 0n,
      totalMinor: total,
      position: 1,
      ...(opts.itemId ? { inventoryItemId: opts.itemId } : {}),
    },
  });
  await recordAuthorization({
    db: dbModule.db,
    context: opts.context,
    revisionId: revision.id,
    method: "IN_PERSON",
    providedByName: "Customer",
    decisions: [{ estimateLineId: line.id, decision: "APPROVED" }],
  });
  return { wo, revision, line };
}

describe("auto-consume at invoicing (#237)", { skip: shouldSkip }, () => {
  it("issues linked part lines from stock when the invoice is created", async () => {
    const { createInvoiceFromWorkOrder } = await import("@/modules/invoices/invoice-service");
    const seed = await seedShop("Consume");
    const item = await dbModule.db.inventoryItem.create({
      data: {
        organizationId: seed.orgId,
        partNumber: "CON-1",
        name: "Consumable",
        quantityOnHand: 5,
        unitCostMinor: 100n,
      },
    });
    const { wo } = await presentedApprovedLinkedLine({
      ...seed,
      itemId: item.id,
      quantityMilli: 2000,
      workOrderNumber: "RO-4001",
      context: seed.context(),
    });

    const invoice = await createInvoiceFromWorkOrder({
      db: dbModule.db,
      context: seed.context(),
      workOrderId: wo.id,
    });
    expect(invoice.invoiceId).toBeTruthy();

    const onHand = await dbModule.db.inventoryItem.findUnique({ where: { id: item.id } });
    expect(onHand?.quantityOnHand).toBe(3);

    const movements = await dbModule.db.inventoryMovement.findMany({
      where: { organizationId: seed.orgId },
    });
    expect(movements).toHaveLength(1);
    expect(movements[0]!.delta).toBe(-2);

    const invoiceLine = await dbModule.db.invoiceLine.findFirst({
      where: { invoiceId: invoice.invoiceId },
    });
    expect(invoiceLine?.inventoryItemId).toBe(item.id);
  });

  it("consumes reservations first and never double-decrements", async () => {
    const { reserveStock } = await import("@/modules/inventory/inventory-service");
    const { createInvoiceFromWorkOrder } = await import("@/modules/invoices/invoice-service");
    const seed = await seedShop("ConsumeHold");
    const item = await dbModule.db.inventoryItem.create({
      data: {
        organizationId: seed.orgId,
        partNumber: "CON-2",
        name: "Held consumable",
        quantityOnHand: 5,
        unitCostMinor: 100n,
      },
    });
    const { wo, line } = await presentedApprovedLinkedLine({
      ...seed,
      itemId: item.id,
      quantityMilli: 3000,
      workOrderNumber: "RO-4002",
      context: seed.context(),
    });
    await reserveStock({
      db: dbModule.db,
      context: seed.context(),
      itemId: item.id,
      workOrderId: wo.id,
      quantity: 2,
      estimateLineId: line.id,
    });

    await createInvoiceFromWorkOrder({
      db: dbModule.db,
      context: seed.context(),
      workOrderId: wo.id,
    });

    const onHand = await dbModule.db.inventoryItem.findUnique({ where: { id: item.id } });
    expect(onHand?.quantityOnHand).toBe(2); // 5 − 3 total, holds included once

    const movements = await dbModule.db.inventoryMovement.findMany({
      where: { organizationId: seed.orgId },
    });
    expect(movements).toHaveLength(1);
    expect(movements[0]!.delta).toBe(-3);

    const holds = await dbModule.db.inventoryReservation.findMany({
      where: { organizationId: seed.orgId },
    });
    expect(holds[0]!.status).toBe("CONSUMED");
  });

  it("never blocks invoicing when stock shows short — flags a discrepancy instead", async () => {
    const { createInvoiceFromWorkOrder } = await import("@/modules/invoices/invoice-service");
    const seed = await seedShop("ConsumeZero");
    const item = await dbModule.db.inventoryItem.create({
      data: {
        organizationId: seed.orgId,
        partNumber: "CON-3",
        name: "Phantom part",
        quantityOnHand: 0,
        unitCostMinor: 100n,
      },
    });
    const { wo } = await presentedApprovedLinkedLine({
      ...seed,
      itemId: item.id,
      quantityMilli: 2000,
      workOrderNumber: "RO-4003",
      context: seed.context(),
    });

    const invoice = await createInvoiceFromWorkOrder({
      db: dbModule.db,
      context: seed.context(),
      workOrderId: wo.id,
    });
    expect(invoice.invoiceId).toBeTruthy();

    const movements = await dbModule.db.inventoryMovement.findMany({
      where: { organizationId: seed.orgId },
    });
    expect(movements).toHaveLength(0);

    const discrepancy = await dbModule.db.activityEvent.findFirst({
      where: { organizationId: seed.orgId, eventType: "inventory.discrepancy" },
    });
    expect(discrepancy?.summary).toContain("CON-3");
  });

  it("does nothing when the org turns auto-issue off or lines are unlinked", async () => {
    const { createInvoiceFromWorkOrder } = await import("@/modules/invoices/invoice-service");
    const seed = await seedShop("ConsumeOff");
    await dbModule.db.organization.update({
      where: { id: seed.orgId },
      data: { autoIssueStockOnInvoice: false },
    });
    const item = await dbModule.db.inventoryItem.create({
      data: {
        organizationId: seed.orgId,
        partNumber: "CON-4",
        name: "Off part",
        quantityOnHand: 5,
        unitCostMinor: 100n,
      },
    });
    const linked = await presentedApprovedLinkedLine({
      ...seed,
      itemId: item.id,
      quantityMilli: 1000,
      workOrderNumber: "RO-4004",
      context: seed.context(),
    });
    await createInvoiceFromWorkOrder({
      db: dbModule.db,
      context: seed.context(),
      workOrderId: linked.wo.id,
    });
    const unlinked = await presentedApprovedLinkedLine({
      ...seed,
      itemId: null,
      quantityMilli: 1000,
      workOrderNumber: "RO-4005",
      context: seed.context(),
    });
    await createInvoiceFromWorkOrder({
      db: dbModule.db,
      context: seed.context(),
      workOrderId: unlinked.wo.id,
    });

    const onHand = await dbModule.db.inventoryItem.findUnique({ where: { id: item.id } });
    expect(onHand?.quantityOnHand).toBe(5);
    const movements = await dbModule.db.inventoryMovement.findMany({
      where: { organizationId: seed.orgId },
    });
    expect(movements).toHaveLength(0);
  });

  it("is idempotent — a second consume attempt writes nothing", async () => {
    const { createInvoiceFromWorkOrder } = await import("@/modules/invoices/invoice-service");
    const { autoConsumeStockForInvoice } = await import("@/modules/inventory/inventory-service");
    const seed = await seedShop("ConsumeTwice");
    const item = await dbModule.db.inventoryItem.create({
      data: {
        organizationId: seed.orgId,
        partNumber: "CON-5",
        name: "Stable part",
        quantityOnHand: 5,
        unitCostMinor: 100n,
      },
    });
    const { wo } = await presentedApprovedLinkedLine({
      ...seed,
      itemId: item.id,
      quantityMilli: 1000,
      workOrderNumber: "RO-4006",
      context: seed.context(),
    });
    const invoice = await createInvoiceFromWorkOrder({
      db: dbModule.db,
      context: seed.context(),
      workOrderId: wo.id,
    });

    const again = await autoConsumeStockForInvoice({
      db: dbModule.db,
      context: seed.context(),
      invoiceId: invoice.invoiceId,
    });
    expect(again.consumedLines).toBe(0);

    const movements = await dbModule.db.inventoryMovement.findMany({
      where: { organizationId: seed.orgId },
    });
    expect(movements).toHaveLength(1);
    const onHand = await dbModule.db.inventoryItem.findUnique({ where: { id: item.id } });
    expect(onHand?.quantityOnHand).toBe(4);
  });

  it("rejects an estimate line linked to another organization's item", async () => {
    const { addLine } = await import("@/modules/estimates/estimate-service");
    const seedA = await seedShop("LinkA");
    const seedB = await seedShop("LinkB");
    const foreignItem = await dbModule.db.inventoryItem.create({
      data: {
        organizationId: seedB.orgId,
        partNumber: "FRN-1",
        name: "Foreign part",
        quantityOnHand: 5,
        unitCostMinor: 100n,
      },
    });
    const wo = await dbModule.db.workOrder.create({
      data: {
        organizationId: seedA.orgId,
        locationId: seedA.locationId,
        customerId: seedA.customerId,
        number: "RO-4007",
        customerConcern: "link",
        status: "ESTIMATING",
      },
    });
    const revision = await dbModule.db.estimateRevision.create({
      data: {
        organizationId: seedA.orgId,
        locationId: seedA.locationId,
        workOrderId: wo.id,
        revisionNumber: 1,
        status: "DRAFT",
        documentKind: "BASELINE",
        currency: "USD",
        subtotalMinor: 0n,
        discountMinor: 0n,
        taxMinor: 0n,
        totalMinor: 0n,
      },
    });

    await expect(
      addLine({
        db: dbModule.db,
        context: seedA.context(),
        revisionId: revision.id,
        kind: "PART",
        serviceGroupKey: "general",
        description: "foreign link",
        quantityMilli: 1000,
        unitPriceMinor: 1000,
        discountMinor: 0,
        taxable: false,
        taxRateBasisPoints: 0,
        position: 1,
        inventoryItemId: foreignItem.id,
      }),
    ).rejects.toMatchObject({ reason: "inventory_item_not_found" });
  });
});
