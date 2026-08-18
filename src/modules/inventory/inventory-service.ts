import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import { assertTenantAccess, type TenantContext } from "@/modules/tenancy/policy";

export type InventoryServiceInput = Readonly<{ db: PrismaClient; context: TenantContext }>;

export class InventoryFailed extends Error {
  constructor(
    public readonly reason:
      | "item_not_found"
      | "invalid_part_number"
      | "invalid_name"
      | "duplicate_part_number"
      | "invalid_quantity"
      | "insufficient_stock",
  ) {
    super("The inventory operation could not be completed.");
    this.name = "InventoryFailed";
  }
}

/** Creates a stocked part with its on-hand quantity and reorder point. */
export async function createItem(
  input: InventoryServiceInput & {
    partNumber: string;
    name: string;
    quantityOnHand?: number;
    reorderPoint?: number;
    unitCostMinor?: number;
    currency?: string;
    binLocation?: string;
  },
): Promise<Readonly<{ itemId: string }>> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );

  const partNumber = input.partNumber.trim();
  const name = input.name.trim();
  if (partNumber.length < 1 || partNumber.length > 120)
    throw new InventoryFailed("invalid_part_number");
  if (name.length < 2 || name.length > 220) throw new InventoryFailed("invalid_name");
  for (const quantity of [input.quantityOnHand, input.reorderPoint, input.unitCostMinor]) {
    if (quantity !== undefined && (!Number.isSafeInteger(quantity) || quantity < 0)) {
      throw new InventoryFailed("invalid_quantity");
    }
  }

  const existing = await input.db.inventoryItem.findFirst({
    where: { organizationId: input.context.organizationId, partNumber },
    select: { id: true },
  });
  if (existing) throw new InventoryFailed("duplicate_part_number");

  const item = await input.db.inventoryItem.create({
    data: {
      id: randomUUID(),
      organizationId: input.context.organizationId,
      partNumber,
      name,
      ...(input.quantityOnHand ? { quantityOnHand: input.quantityOnHand } : {}),
      ...(input.reorderPoint ? { reorderPoint: input.reorderPoint } : {}),
      ...(input.unitCostMinor ? { unitCostMinor: BigInt(input.unitCostMinor) } : {}),
      ...(input.currency ? { currency: input.currency } : {}),
      ...(input.binLocation ? { binLocation: input.binLocation.trim() } : {}),
    },
  });
  return { itemId: item.id };
}

/** Adjusts stock (+/−) with a reason note; negative results are rejected. */
export async function adjustStock(
  input: InventoryServiceInput & { itemId: string; delta: number; note?: string },
): Promise<Readonly<{ quantityOnHand: number }>> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );

  if (!Number.isSafeInteger(input.delta) || input.delta === 0) {
    throw new InventoryFailed("invalid_quantity");
  }

  return input.db.$transaction(async (transaction) => {
    const item = await transaction.inventoryItem.findFirst({
      where: { id: input.itemId, organizationId: input.context.organizationId },
      select: { id: true, quantityOnHand: true, name: true },
    });
    if (!item) throw new InventoryFailed("item_not_found");

    const next = item.quantityOnHand + input.delta;
    if (next < 0) throw new InventoryFailed("insufficient_stock");

    await transaction.inventoryItem.update({
      where: { id: item.id },
      data: { quantityOnHand: next },
    });
    return { quantityOnHand: next };
  });
}

/**
 * Receives a part-order line into stock: upserts the inventory item by part
 * number (creating it from the line's description and cost when new) and
 * increments on-hand by the received quantity.
 */
export async function receiveIntoStock(
  input: InventoryServiceInput & {
    partNumber: string;
    name: string;
    quantity: number;
    unitCostMinor: number;
    currency?: string;
    binLocation?: string;
  },
): Promise<Readonly<{ itemId: string; quantityOnHand: number }>> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );

  if (!Number.isSafeInteger(input.quantity) || input.quantity < 1) {
    throw new InventoryFailed("invalid_quantity");
  }

  return input.db.$transaction(async (transaction) => {
    const existing = await transaction.inventoryItem.findFirst({
      where: { organizationId: input.context.organizationId, partNumber: input.partNumber.trim() },
      select: { id: true, quantityOnHand: true },
    });
    if (existing) {
      const next = existing.quantityOnHand + input.quantity;
      await transaction.inventoryItem.update({
        where: { id: existing.id },
        data: {
          quantityOnHand: next,
          unitCostMinor: BigInt(input.unitCostMinor),
          ...(input.currency ? { currency: input.currency } : {}),
        },
      });
      return { itemId: existing.id, quantityOnHand: next };
    }

    const item = await transaction.inventoryItem.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        partNumber: input.partNumber.trim(),
        name: input.name.trim(),
        quantityOnHand: input.quantity,
        unitCostMinor: BigInt(input.unitCostMinor),
        ...(input.currency ? { currency: input.currency } : {}),
        ...(input.binLocation ? { binLocation: input.binLocation.trim() } : {}),
      },
    });
    return { itemId: item.id, quantityOnHand: item.quantityOnHand };
  });
}

/** Issues (consumes) stock for use on a job. */
export async function issueStock(
  input: InventoryServiceInput & { itemId: string; quantity: number },
): Promise<Readonly<{ quantityOnHand: number }>> {
  return adjustStock({ ...input, delta: -input.quantity });
}

export type InventoryItemSummary = Readonly<{
  id: string;
  partNumber: string;
  name: string;
  quantityOnHand: number;
  reorderPoint: number;
  unitCostMinor: string;
  currency: string;
  binLocation: string | null;
  low: boolean;
}>;

/** Lists stock; low-stock (at/below reorder point) sorts first when asked. */
export async function listItems(
  input: InventoryServiceInput,
  options?: Readonly<{ lowOnly?: boolean }>,
): Promise<readonly InventoryItemSummary[]> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.read",
  );

  const items = await input.db.inventoryItem.findMany({
    where: { organizationId: input.context.organizationId },
    orderBy: [{ name: "asc" }],
    take: 500,
    select: {
      id: true,
      partNumber: true,
      name: true,
      quantityOnHand: true,
      reorderPoint: true,
      unitCostMinor: true,
      currency: true,
      binLocation: true,
    },
  });

  const summaries = items.map((item) => ({
    id: item.id,
    partNumber: item.partNumber,
    name: item.name,
    quantityOnHand: item.quantityOnHand,
    reorderPoint: item.reorderPoint,
    unitCostMinor: item.unitCostMinor.toString(),
    currency: item.currency,
    binLocation: item.binLocation,
    low: item.quantityOnHand <= item.reorderPoint,
  }));

  if (options?.lowOnly) return summaries.filter((summary) => summary.low);
  return summaries;
}

// ─── Auto-reorder suggestions ───────────────────────────────────────────────

export class ReorderFailed extends Error {
  constructor(
    public readonly reason:
      "work_order_not_found" | "supplier_not_found" | "item_not_found" | "nothing_to_order",
  ) {
    super("The reorder operation could not be completed.");
    this.name = "ReorderFailed";
  }
}

export type ReorderSuggestion = Readonly<{
  itemId: string;
  partNumber: string;
  name: string;
  quantityOnHand: number;
  reorderPoint: number;
  unitCostMinor: string;
  currency: string;
  suggestedQuantity: number;
  supplierId: string | null;
  supplierName: string | null;
}>;

/**
 * Low-stock items with a suggested reorder quantity (reorder point minus
 * on-hand, at least 1), matched to the supplier from the most recent open
 * part-order line with the same part number when one exists.
 */
export async function listReorderSuggestions(
  input: InventoryServiceInput,
): Promise<readonly ReorderSuggestion[]> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.read",
  );

  const items = await input.db.inventoryItem.findMany({
    where: {
      organizationId: input.context.organizationId,
      quantityOnHand: { lte: input.db.inventoryItem.fields.reorderPoint },
    },
    orderBy: { name: "asc" },
    take: 100,
    select: {
      id: true,
      partNumber: true,
      name: true,
      quantityOnHand: true,
      reorderPoint: true,
      unitCostMinor: true,
      currency: true,
    },
  });

  const suggestions: ReorderSuggestion[] = [];
  for (const item of items) {
    const lastLine = await input.db.partOrderLine.findFirst({
      where: {
        organizationId: input.context.organizationId,
        partNumber: item.partNumber,
      },
      orderBy: { createdAt: "desc" },
      select: {
        partOrder: {
          select: {
            supplierId: true,
            supplier: { select: { name: true } },
          },
        },
      },
    });
    suggestions.push({
      itemId: item.id,
      partNumber: item.partNumber,
      name: item.name,
      quantityOnHand: item.quantityOnHand,
      reorderPoint: item.reorderPoint,
      unitCostMinor: item.unitCostMinor.toString(),
      currency: item.currency,
      suggestedQuantity: Math.max(1, item.reorderPoint - item.quantityOnHand),
      supplierId: lastLine?.partOrder.supplierId ?? null,
      supplierName: lastLine?.partOrder.supplier.name ?? null,
    });
  }
  return suggestions;
}

/**
 * Creates a REQUESTED part order on a work order from low-stock suggestions
 * (restock run). One line per selected item at its current cost, through the
 * normal part-order flow — receiving later can feed stock with "→ stock".
 */
export async function createReorderFromSuggestions(
  input: InventoryServiceInput & {
    workOrderId: string;
    itemIds: ReadonlyArray<string>;
    supplierId?: string;
  },
): Promise<Readonly<{ partOrderId: string }>> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );

  if (input.itemIds.length === 0) throw new ReorderFailed("nothing_to_order");

  return input.db.$transaction(async (transaction) => {
    const workOrder = await transaction.workOrder.findFirst({
      where: { id: input.workOrderId, organizationId: input.context.organizationId },
      select: { id: true, locationId: true },
    });
    if (!workOrder) throw new ReorderFailed("work_order_not_found");

    const items = await transaction.inventoryItem.findMany({
      where: {
        id: { in: [...input.itemIds] },
        organizationId: input.context.organizationId,
      },
      select: {
        id: true,
        partNumber: true,
        name: true,
        quantityOnHand: true,
        reorderPoint: true,
        unitCostMinor: true,
        currency: true,
      },
    });
    if (items.length === 0) throw new ReorderFailed("item_not_found");

    const partNumbers = items.map((item) => item.partNumber);
    const supplierId =
      input.supplierId ??
      (
        await transaction.partOrderLine.findFirst({
          where: {
            organizationId: input.context.organizationId,
            partNumber: { in: partNumbers },
          },
          orderBy: { createdAt: "desc" },
          include: { partOrder: { select: { supplierId: true } } },
        })
      )?.partOrder.supplierId ??
      null;
    if (!supplierId) {
      // Part orders require a supplier; none was given and no history matches.
      throw new ReorderFailed("supplier_not_found");
    }
    const supplier = await transaction.partSupplier.findFirst({
      where: { id: supplierId, organizationId: input.context.organizationId },
      select: { id: true },
    });
    if (!supplier) throw new ReorderFailed("supplier_not_found");

    const partOrder = await transaction.partOrder.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        locationId: workOrder.locationId,
        workOrderId: workOrder.id,
        supplierId,
        status: "REQUESTED",
        source: "MANUAL",
        currency: items[0]?.currency ?? "USD",
        note: "Restock run from low inventory.",
        createdByUserId: input.context.actorId,
      },
    });

    for (const item of items) {
      await transaction.partOrderLine.create({
        data: {
          id: randomUUID(),
          organizationId: input.context.organizationId,
          partOrderId: partOrder.id,
          description: item.name,
          partNumber: item.partNumber,
          quantity: Math.max(1, item.reorderPoint - item.quantityOnHand),
          unitCostMinor: item.unitCostMinor,
        },
      });
    }

    return { partOrderId: partOrder.id };
  });
}
