import { randomUUID } from "node:crypto";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { assertTenantAccess, type TenantContext } from "@/modules/tenancy/policy";

export type InventoryServiceInput = Readonly<{ db: PrismaClient; context: TenantContext }>;

export type StockMovementReason =
  "RECEIVED" | "ISSUED_TO_JOB" | "MANUAL_ADJUSTMENT" | "RETURNED_TO_STOCK";

/**
 * Appends a movement row next to a quantityOnHand change. Callers must keep
 * the movement insert in the same transaction as the stock update; the table
 * is append-only (enforced by trigger), corrections are new rows.
 */
export async function recordStockMovement(
  transaction: Prisma.TransactionClient,
  context: TenantContext,
  movement: Readonly<{
    inventoryItemId: string;
    delta: number;
    reason: StockMovementReason;
    locationId?: string | undefined;
    workOrderId?: string | undefined;
    partOrderLineId?: string | undefined;
    invoiceLineId?: string | undefined;
    note?: string | undefined;
  }>,
): Promise<void> {
  await transaction.inventoryMovement.create({
    data: {
      id: randomUUID(),
      organizationId: context.organizationId,
      inventoryItemId: movement.inventoryItemId,
      delta: movement.delta,
      reason: movement.reason,
      ...(movement.locationId ? { locationId: movement.locationId } : {}),
      ...(movement.workOrderId ? { workOrderId: movement.workOrderId } : {}),
      ...(movement.partOrderLineId ? { partOrderLineId: movement.partOrderLineId } : {}),
      ...(movement.invoiceLineId ? { invoiceLineId: movement.invoiceLineId } : {}),
      ...(movement.note ? { note: movement.note.slice(0, 280) } : {}),
      ...(context.actorId ? { createdById: context.actorId } : {}),
    },
  });
}

export class InventoryFailed extends Error {
  constructor(
    public readonly reason:
      | "item_not_found"
      | "invalid_part_number"
      | "invalid_name"
      | "duplicate_part_number"
      | "invalid_quantity"
      | "insufficient_stock"
      | "work_order_not_found"
      | "work_order_not_open"
      | "line_not_found",
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
    locationId?: string | null;
    oeNumber?: string;
    brand?: string;
    categoryId?: string;
    uomGroup?: string;
    unitOfMeasure?: string;
    uomFactorMilli?: number;
    condition?: "new" | "used" | "refurb";
    hasCore?: boolean;
    coreValueMinor?: number;
    consumable?: boolean;
    nonSaleable?: boolean;
    quantityOnHand?: number;
    reorderPoint?: number;
    unitCostMinor?: number;
    currency?: string;
    binLocation?: string;
    notes?: string;
  },
): Promise<Readonly<{ itemId: string }>> {
  // Location-scoped items verify location access; org-wide (null) items
  // are managed by any writer and inherited by every location.
  if (input.locationId) {
    assertTenantAccess(
      input.context,
      { organizationId: input.context.organizationId, locationId: input.locationId },
      "work_orders.write",
    );
  } else {
    assertTenantAccess(
      input.context,
      { organizationId: input.context.organizationId },
      "work_orders.write",
    );
  }

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
  if (input.coreValueMinor !== undefined && !input.hasCore) {
    throw new InventoryFailed("invalid_quantity");
  }

  // Uniqueness is per location (null = shared org stock): the same part
  // number can live at two shops with independent on-hand.
  const existing = await input.db.inventoryItem.findFirst({
    where: {
      organizationId: input.context.organizationId,
      partNumber,
      ...(input.locationId ? { locationId: input.locationId } : { locationId: null }),
    },
    select: { id: true },
  });
  if (existing) throw new InventoryFailed("duplicate_part_number");

  const item = await input.db.inventoryItem.create({
    data: {
      id: randomUUID(),
      organizationId: input.context.organizationId,
      ...(input.locationId ? { locationId: input.locationId } : {}),
      partNumber,
      name,
      ...(input.oeNumber ? { oeNumber: input.oeNumber.trim() } : {}),
      ...(input.brand ? { brand: input.brand.trim() } : {}),
      ...(input.categoryId ? { categoryId: input.categoryId } : {}),
      ...(input.uomGroup ? { uomGroup: input.uomGroup.trim() } : {}),
      ...(input.unitOfMeasure ? { unitOfMeasure: input.unitOfMeasure.trim() } : {}),
      ...(input.uomFactorMilli !== undefined ? { uomFactorMilli: input.uomFactorMilli } : {}),
      ...(input.condition ? { condition: input.condition } : {}),
      ...(input.hasCore !== undefined ? { hasCore: input.hasCore } : {}),
      ...(input.coreValueMinor !== undefined
        ? { coreValueMinor: BigInt(input.coreValueMinor) }
        : {}),
      ...(input.consumable !== undefined ? { consumable: input.consumable } : {}),
      ...(input.nonSaleable !== undefined ? { nonSaleable: input.nonSaleable } : {}),
      ...(input.quantityOnHand ? { quantityOnHand: input.quantityOnHand } : {}),
      ...(input.reorderPoint ? { reorderPoint: input.reorderPoint } : {}),
      ...(input.unitCostMinor ? { unitCostMinor: BigInt(input.unitCostMinor) } : {}),
      ...(input.currency ? { currency: input.currency } : {}),
      ...(input.binLocation ? { binLocation: input.binLocation.trim() } : {}),
      ...(input.notes ? { notes: input.notes.trim() } : {}),
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
    await recordStockMovement(transaction, input.context, {
      inventoryItemId: item.id,
      delta: input.delta,
      reason: input.delta > 0 ? "RETURNED_TO_STOCK" : "MANUAL_ADJUSTMENT",
      note: input.note ?? (input.delta > 0 ? "Manual add to stock" : "Manual correction"),
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
    workOrderId?: string;
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
    // When the receive hangs off a work order, resolve and validate it in
    // this tenant so the movement lineage can never point across orgs.
    let workOrder: { id: string; locationId: string } | null = null;
    if (input.workOrderId) {
      workOrder = await transaction.workOrder.findFirst({
        where: { id: input.workOrderId, organizationId: input.context.organizationId },
        select: { id: true, locationId: true },
      });
      if (!workOrder) throw new InventoryFailed("item_not_found");
    }

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
      await recordStockMovement(transaction, input.context, {
        inventoryItemId: existing.id,
        delta: input.quantity,
        reason: "RECEIVED",
        ...(workOrder ? { locationId: workOrder.locationId } : {}),
        ...(workOrder ? { workOrderId: workOrder.id } : {}),
        note: `Received ${input.partNumber.trim()}`,
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
    await recordStockMovement(transaction, input.context, {
      inventoryItemId: item.id,
      delta: input.quantity,
      reason: "RECEIVED",
      ...(workOrder ? { locationId: workOrder.locationId } : {}),
      ...(workOrder ? { workOrderId: workOrder.id } : {}),
      note: `Received ${item.partNumber} (new item)`,
    });
    return { itemId: item.id, quantityOnHand: item.quantityOnHand };
  });
}

/** Issues (consumes) stock for use on a job. */
export async function issueStock(
  input: InventoryServiceInput & {
    itemId: string;
    quantity: number;
    workOrderId?: string;
    note?: string;
  },
): Promise<Readonly<{ quantityOnHand: number }>> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );

  if (!Number.isSafeInteger(input.quantity) || input.quantity < 1) {
    throw new InventoryFailed("invalid_quantity");
  }

  return input.db.$transaction(async (transaction) => {
    let workOrder: { id: string; locationId: string } | null = null;
    if (input.workOrderId) {
      workOrder = await transaction.workOrder.findFirst({
        where: { id: input.workOrderId, organizationId: input.context.organizationId },
        select: { id: true, locationId: true },
      });
      if (!workOrder) throw new InventoryFailed("item_not_found");
    }

    const item = await transaction.inventoryItem.findFirst({
      where: { id: input.itemId, organizationId: input.context.organizationId },
      select: { id: true, quantityOnHand: true },
    });
    if (!item) throw new InventoryFailed("item_not_found");
    if (item.quantityOnHand - input.quantity < 0) {
      throw new InventoryFailed("insufficient_stock");
    }

    const next = item.quantityOnHand - input.quantity;
    await transaction.inventoryItem.update({
      where: { id: item.id },
      data: { quantityOnHand: next },
    });
    await recordStockMovement(transaction, input.context, {
      inventoryItemId: item.id,
      delta: -input.quantity,
      reason: "ISSUED_TO_JOB",
      ...(workOrder ? { locationId: workOrder.locationId, workOrderId: workOrder.id } : {}),
      ...(input.note ? { note: input.note } : {}),
    });
    return { quantityOnHand: next };
  });
}

export type StockMovementRow = Readonly<{
  id: string;
  delta: number;
  reason: string;
  note: string | null;
  createdAt: Date;
  workOrderId: string | null;
  workOrderNumber: string | null;
  createdByName: string | null;
}>;

/** Newest-first movement history for one item (or everything a job touched). */
export async function listMovements(
  input: InventoryServiceInput & { itemId?: string; workOrderId?: string; take?: number },
): Promise<readonly StockMovementRow[]> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.read",
  );

  const rows = await input.db.inventoryMovement.findMany({
    where: {
      organizationId: input.context.organizationId,
      ...(input.itemId ? { inventoryItemId: input.itemId } : {}),
      ...(input.workOrderId ? { workOrderId: input.workOrderId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: input.take ?? 50,
    select: {
      id: true,
      delta: true,
      reason: true,
      note: true,
      createdAt: true,
      workOrder: { select: { id: true, number: true } },
      createdBy: { select: { displayName: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    delta: row.delta,
    reason: row.reason,
    note: row.note,
    createdAt: row.createdAt,
    workOrderId: row.workOrder?.id ?? null,
    workOrderNumber: row.workOrder?.number ?? null,
    createdByName: row.createdBy?.displayName ?? null,
  }));
}

export type InventoryItemSummary = Readonly<{
  id: string;
  partNumber: string;
  name: string;
  locationId: string | null;
  oeNumber: string | null;
  brand: string | null;
  categoryId: string | null;
  uomGroup: string | null;
  unitOfMeasure: string | null;
  condition: string;
  hasCore: boolean;
  consumable: boolean;
  nonSaleable: boolean;
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
  options?: Readonly<{
    lowOnly?: boolean;
    locationId?: string;
    categoryId?: string;
    consumablesOnly?: boolean;
    oeNumber?: string;
  }>,
): Promise<readonly InventoryItemSummary[]> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.read",
  );

  // Location scope: a location-restricted viewer sees their own stock plus
  // org-wide (null-location) items; org-wide viewers see everything.
  const where: Record<string, unknown> = { organizationId: input.context.organizationId };
  if (!input.context.organizationWideLocationAccess && input.context.allowedLocationIds.size > 0) {
    where.OR = [
      { locationId: { in: [...input.context.allowedLocationIds] } },
      { locationId: null },
    ];
  }
  if (options?.locationId) {
    where.OR = [{ locationId: options.locationId }, { locationId: null }];
  }
  if (options?.categoryId) where.categoryId = options.categoryId;
  if (options?.consumablesOnly) where.consumable = true;
  if (options?.oeNumber) where.oeNumber = options.oeNumber.trim();

  const items = await input.db.inventoryItem.findMany({
    where,
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
      locationId: true,
      oeNumber: true,
      brand: true,
      categoryId: true,
      uomGroup: true,
      unitOfMeasure: true,
      condition: true,
      hasCore: true,
      consumable: true,
      nonSaleable: true,
    },
  });

  const summaries = items.map((item) => ({
    id: item.id,
    partNumber: item.partNumber,
    name: item.name,
    locationId: item.locationId,
    oeNumber: item.oeNumber,
    brand: item.brand,
    categoryId: item.categoryId,
    uomGroup: item.uomGroup,
    unitOfMeasure: item.unitOfMeasure,
    condition: item.condition,
    hasCore: item.hasCore,
    consumable: item.consumable,
    nonSaleable: item.nonSaleable,
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

// ─── Categories ─────────────────────────────────────────────────────────────

export async function listCategories(
  input: InventoryServiceInput,
): Promise<
  readonly Readonly<{ id: string; name: string; sortOrder: number; itemCount: number }>[]
> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.read",
  );

  const categories = await input.db.inventoryCategory.findMany({
    where: { organizationId: input.context.organizationId },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      name: true,
      sortOrder: true,
      _count: { select: { items: true } },
    },
  });
  return categories.map((category) => ({
    id: category.id,
    name: category.name,
    sortOrder: category.sortOrder,
    itemCount: category._count.items,
  }));
}

export async function createCategory(
  input: InventoryServiceInput & { name: string; sortOrder?: number },
): Promise<Readonly<{ categoryId: string }>> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );

  const name = input.name.trim();
  if (name.length < 2 || name.length > 120) throw new InventoryFailed("invalid_name");

  const existing = await input.db.inventoryCategory.findFirst({
    where: { organizationId: input.context.organizationId, name },
    select: { id: true },
  });
  if (existing) throw new InventoryFailed("duplicate_part_number");

  const maxOrder = await input.db.inventoryCategory.aggregate({
    where: { organizationId: input.context.organizationId },
    _max: { sortOrder: true },
  });

  const category = await input.db.inventoryCategory.create({
    data: {
      id: randomUUID(),
      organizationId: input.context.organizationId,
      name,
      sortOrder: input.sortOrder ?? (maxOrder._max.sortOrder ?? 0) + 1,
    },
    select: { id: true },
  });
  return { categoryId: category.id };
}

// ─── Interchange lookup ─────────────────────────────────────────────────────

export type InterchangeMatch = Readonly<{
  itemId: string;
  partNumber: string;
  brand: string | null;
  name: string;
  locationId: string | null;
  quantityOnHand: number;
  unitCostMinor: string;
  currency: string;
}>;

/**
 * Parts that interchange on the same OE number — different manufacturers'
 * aftermarket numbers for the same factory part. The shop's substitution
 * cheat sheet: what fits when the brand you stock is out.
 */
export async function findInterchange(
  input: InventoryServiceInput & { oeNumber: string },
): Promise<readonly InterchangeMatch[]> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.read",
  );

  const where: Record<string, unknown> = {
    organizationId: input.context.organizationId,
    oeNumber: input.oeNumber.trim(),
  };
  if (!input.context.organizationWideLocationAccess && input.context.allowedLocationIds.size > 0) {
    where.OR = [
      { locationId: { in: [...input.context.allowedLocationIds] } },
      { locationId: null },
    ];
  }

  const items = await input.db.inventoryItem.findMany({
    where,
    orderBy: { name: "asc" },
    take: 50,
    select: {
      id: true,
      partNumber: true,
      brand: true,
      name: true,
      locationId: true,
      quantityOnHand: true,
      unitCostMinor: true,
      currency: true,
    },
  });
  return items.map((item) => ({
    itemId: item.id,
    partNumber: item.partNumber,
    brand: item.brand,
    name: item.name,
    locationId: item.locationId,
    quantityOnHand: item.quantityOnHand,
    unitCostMinor: item.unitCostMinor.toString(),
    currency: item.currency,
  }));
}

// ─── UoM-aware stock view ───────────────────────────────────────────────────

export type UomGroupSummary = Readonly<{
  group: string;
  /** Total stock in the group's base unit (e.g. total quarts). */
  totalBaseUnits: number;
  containers: ReadonlyArray<
    Readonly<{
      itemId: string;
      partNumber: string;
      name: string;
      unitOfMeasure: string | null;
      quantityOnHand: number;
      /** This container's factor; null items count in whole units. */
      factor: number | null;
    }>
  >;
}>;

/**
 * Stock grouped by unit-of-measure group, totaled in base units — the
 * "how much oil do I actually have" view across quarts, gallons, and drums.
 */
export async function uomSummary(
  input: InventoryServiceInput,
): Promise<readonly UomGroupSummary[]> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.read",
  );

  const where: Record<string, unknown> = {
    organizationId: input.context.organizationId,
    uomGroup: { not: null },
  };
  if (!input.context.organizationWideLocationAccess && input.context.allowedLocationIds.size > 0) {
    where.OR = [
      { locationId: { in: [...input.context.allowedLocationIds] } },
      { locationId: null },
    ];
  }

  const items = await input.db.inventoryItem.findMany({
    where,
    orderBy: { uomGroup: "asc" },
    select: {
      id: true,
      partNumber: true,
      name: true,
      unitOfMeasure: true,
      uomGroup: true,
      uomFactorMilli: true,
      quantityOnHand: true,
    },
  });

  const groups = new Map<string, UomGroupSummary>();
  for (const item of items) {
    const groupName = item.uomGroup!;
    const factor = item.uomFactorMilli !== null ? item.uomFactorMilli / 1000 : null;
    const group = groups.get(groupName) ?? { group: groupName, totalBaseUnits: 0, containers: [] };
    const next = {
      ...group,
      totalBaseUnits: group.totalBaseUnits + (factor ?? 1) * item.quantityOnHand,
      containers: [
        ...group.containers,
        {
          itemId: item.id,
          partNumber: item.partNumber,
          name: item.name,
          unitOfMeasure: item.unitOfMeasure,
          quantityOnHand: item.quantityOnHand,
          factor,
        },
      ],
    };
    groups.set(groupName, next);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    totalBaseUnits: Math.round(group.totalBaseUnits * 1000) / 1000,
  }));
}

// --- Reservations (soft holds over on-hand stock) ---

export type ItemAvailability = Readonly<{
  onHand: number;
  reserved: number;
  available: number;
}>;

/**
 * Holds stock for a pending work order without touching on-hand. The
 * optional estimate-line link lets declines and superseded revisions release
 * exactly the hold that belonged to them.
 */
export async function reserveStock(
  input: InventoryServiceInput & {
    itemId: string;
    workOrderId: string;
    quantity: number;
    estimateLineId?: string;
    note?: string;
  },
): Promise<Readonly<{ reservationId: string; available: number }>> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );

  if (!Number.isSafeInteger(input.quantity) || input.quantity < 1) {
    throw new InventoryFailed("invalid_quantity");
  }

  return input.db.$transaction(async (transaction) => {
    const [item, workOrder, line] = await Promise.all([
      transaction.inventoryItem.findFirst({
        where: { id: input.itemId, organizationId: input.context.organizationId },
        select: { id: true, quantityOnHand: true },
      }),
      transaction.workOrder.findFirst({
        where: { id: input.workOrderId, organizationId: input.context.organizationId },
        select: { id: true, status: true },
      }),
      input.estimateLineId
        ? transaction.estimateLine.findFirst({
            where: {
              id: input.estimateLineId,
              organizationId: input.context.organizationId,
            },
            select: { id: true },
          })
        : Promise.resolve(null),
    ]);
    if (!item) throw new InventoryFailed("item_not_found");
    if (!workOrder) throw new InventoryFailed("work_order_not_found");
    if (input.estimateLineId && !line) throw new InventoryFailed("line_not_found");
    if (workOrder.status === "CANCELLED" || workOrder.status === "CLOSED") {
      throw new InventoryFailed("work_order_not_open");
    }

    const reserved = await sumActiveReservations(transaction, input.context, item.id);
    if (item.quantityOnHand - reserved - input.quantity < 0) {
      throw new InventoryFailed("insufficient_stock");
    }

    const reservation = await transaction.inventoryReservation.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        inventoryItemId: item.id,
        workOrderId: workOrder.id,
        ...(input.estimateLineId ? { estimateLineId: input.estimateLineId } : {}),
        quantity: input.quantity,
        ...(input.note ? { note: input.note.slice(0, 280) } : {}),
        ...(input.context.actorId ? { createdById: input.context.actorId } : {}),
      },
    });
    return {
      reservationId: reservation.id,
      available: item.quantityOnHand - reserved - input.quantity,
    };
  });
}

async function sumActiveReservations(
  transaction: Prisma.TransactionClient,
  context: TenantContext,
  itemId: string,
): Promise<number> {
  const rows = await transaction.inventoryReservation.aggregate({
    where: {
      organizationId: context.organizationId,
      inventoryItemId: itemId,
      status: "ACTIVE",
    },
    _sum: { quantity: true },
  });
  return rows._sum.quantity ?? 0;
}

/**
 * Marks ACTIVE reservations RELEASED. Used by the manual release action and
 * by estimate lifecycle hooks (declined lines, superseded revisions,
 * cancelled work orders). Runs inside the caller's transaction when one is
 * provided.
 */
export async function releaseActiveReservations(
  transaction: Prisma.TransactionClient,
  context: TenantContext,
  where: Readonly<{
    reservationIds?: readonly string[];
    estimateLineIds?: readonly string[];
    workOrderId?: string;
  }>,
  note: string,
): Promise<number> {
  const result = await transaction.inventoryReservation.updateMany({
    where: {
      organizationId: context.organizationId,
      status: "ACTIVE",
      ...(where.reservationIds ? { id: { in: [...where.reservationIds] } } : {}),
      ...(where.estimateLineIds ? { estimateLineId: { in: [...where.estimateLineIds] } } : {}),
      ...(where.workOrderId ? { workOrderId: where.workOrderId } : {}),
    },
    data: { status: "RELEASED", releasedAt: new Date(), note: note.slice(0, 280) },
  });
  return result.count;
}

/** Releases one reservation from the UI. */
export async function releaseReservation(
  input: InventoryServiceInput & { reservationId: string },
): Promise<Readonly<{ released: boolean }>> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );
  const count = await releaseActiveReservations(
    input.db,
    input.context,
    { reservationIds: [input.reservationId] },
    "Released manually",
  );
  return { released: count > 0 };
}

/**
 * Converts every ACTIVE reservation on a work order into stock consumption:
 * on-hand is decremented, an ISSUED_TO_JOB movement is written per hold, and
 * the reservation is marked CONSUMED. Already-released holds are untouched,
 * so the action is idempotent.
 */
export async function issueReservationsForWorkOrder(
  input: InventoryServiceInput & { workOrderId: string },
): Promise<Readonly<{ issued: number }>> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );

  return input.db.$transaction(async (transaction) => {
    const workOrder = await transaction.workOrder.findFirst({
      where: { id: input.workOrderId, organizationId: input.context.organizationId },
      select: { id: true, locationId: true },
    });
    if (!workOrder) throw new InventoryFailed("work_order_not_found");

    const reservations = await transaction.inventoryReservation.findMany({
      where: {
        organizationId: input.context.organizationId,
        workOrderId: workOrder.id,
        status: "ACTIVE",
      },
      select: { id: true, inventoryItemId: true, quantity: true },
    });
    if (reservations.length === 0) return { issued: 0 };

    for (const reservation of reservations) {
      const item = await transaction.inventoryItem.findFirst({
        where: {
          id: reservation.inventoryItemId,
          organizationId: input.context.organizationId,
        },
        select: { id: true, quantityOnHand: true },
      });
      if (!item) throw new InventoryFailed("item_not_found");
      if (item.quantityOnHand - reservation.quantity < 0) {
        throw new InventoryFailed("insufficient_stock");
      }
      await transaction.inventoryItem.update({
        where: { id: item.id },
        data: { quantityOnHand: item.quantityOnHand - reservation.quantity },
      });
      await recordStockMovement(transaction, input.context, {
        inventoryItemId: item.id,
        delta: -reservation.quantity,
        reason: "ISSUED_TO_JOB",
        locationId: workOrder.locationId,
        workOrderId: workOrder.id,
        note: "Issued from reservation",
      });
      await transaction.inventoryReservation.update({
        where: { id: reservation.id },
        data: { status: "CONSUMED", consumedAt: new Date() },
      });
    }
    return { issued: reservations.length };
  });
}

/** On-hand vs held vs available for one item. */
export async function itemAvailability(
  input: InventoryServiceInput & { itemId: string },
): Promise<ItemAvailability> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.read",
  );

  const item = await input.db.inventoryItem.findFirst({
    where: { id: input.itemId, organizationId: input.context.organizationId },
    select: { quantityOnHand: true },
  });
  if (!item) throw new InventoryFailed("item_not_found");

  const reserved = await sumActiveReservations(input.db, input.context, input.itemId);
  return {
    onHand: item.quantityOnHand,
    reserved,
    available: Math.max(0, item.quantityOnHand - reserved),
  };
}

export type ReservationRow = Readonly<{
  id: string;
  quantity: number;
  status: string;
  note: string | null;
  createdAt: Date;
  releasedAt: Date | null;
  consumedAt: Date | null;
  workOrderId: string;
  workOrderNumber: string;
  itemName: string;
  createdByName: string | null;
}>;

/** Reservation history for an item or a work order, newest-first. */
export async function listReservations(
  input: InventoryServiceInput & { itemId?: string; workOrderId?: string; take?: number },
): Promise<readonly ReservationRow[]> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.read",
  );

  const rows = await input.db.inventoryReservation.findMany({
    where: {
      organizationId: input.context.organizationId,
      ...(input.itemId ? { inventoryItemId: input.itemId } : {}),
      ...(input.workOrderId ? { workOrderId: input.workOrderId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: input.take ?? 50,
    select: {
      id: true,
      quantity: true,
      status: true,
      note: true,
      createdAt: true,
      releasedAt: true,
      consumedAt: true,
      workOrderId: true,
      workOrder: { select: { number: true } },
      inventoryItem: { select: { name: true } },
      createdBy: { select: { displayName: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    quantity: row.quantity,
    status: row.status,
    note: row.note,
    createdAt: row.createdAt,
    releasedAt: row.releasedAt,
    consumedAt: row.consumedAt,
    workOrderId: row.workOrderId,
    workOrderNumber: row.workOrder.number,
    itemName: row.inventoryItem.name,
    createdByName: row.createdBy?.displayName ?? null,
  }));
}

/** Active-hold totals per item across the organization (for pickers). */
export async function activeReservedQuantities(
  db: PrismaClient,
  context: TenantContext,
): Promise<Readonly<Record<string, number>>> {
  const rows = await db.inventoryReservation.groupBy({
    by: ["inventoryItemId"],
    where: {
      organizationId: context.organizationId,
      status: "ACTIVE",
    },
    _sum: { quantity: true },
  });
  const totals: Record<string, number> = {};
  for (const row of rows) {
    totals[row.inventoryItemId] = row._sum.quantity ?? 0;
  }
  return totals;
}

/**
 * Best-effort stock consumption for a freshly created invoice. Never
 * blocks or rolls back invoicing:
 *
 * - Skipped entirely when the org turns off auto-issue (their call).
 * - Linked lines consume ACTIVE reservations for the same item and work
 *   order first, so held stock is never double-counted.
 * - On-hand covers the remainder → issue it (movement keyed to the invoice
 *   line, idempotent via partial unique index).
 * - On-hand short (part in hand but never logged) → issue nothing for that
 *   line and record a discrepancy activity event; the shop decides whether
 *   to count stock and issue by hand.
 * - Unlinked lines (customer-supplied parts, other sources) are untouched.
 */
export async function autoConsumeStockForInvoice(
  input: InventoryServiceInput & { invoiceId: string },
): Promise<Readonly<{ consumedLines: number; skippedLines: number }>> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "invoices.issue",
  );

  const org = await input.db.organization.findUnique({
    where: { id: input.context.organizationId },
    select: { autoIssueStockOnInvoice: true },
  });
  if (!org?.autoIssueStockOnInvoice) return { consumedLines: 0, skippedLines: 0 };

  const invoice = await input.db.invoice.findFirst({
    where: { id: input.invoiceId, organizationId: input.context.organizationId },
    select: { id: true, number: true, workOrderId: true, locationId: true },
  });
  if (!invoice?.workOrderId) return { consumedLines: 0, skippedLines: 0 };

  const lines = await input.db.invoiceLine.findMany({
    where: {
      organizationId: input.context.organizationId,
      invoiceId: invoice.id,
      inventoryItemId: { not: null },
    },
    select: { id: true, inventoryItemId: true, quantityMilli: true, description: true },
  });

  let consumedLines = 0;
  let skippedLines = 0;

  for (const line of lines) {
    const itemId = line.inventoryItemId!;
    const invoiceQty = Math.max(1, Math.round(line.quantityMilli / 1000));

    try {
      await input.db.$transaction(async (transaction) => {
        // Idempotency: one consumption movement per invoice line, ever.
        const existing = await transaction.inventoryMovement.findFirst({
          where: {
            organizationId: input.context.organizationId,
            invoiceLineId: line.id,
          },
          select: { id: true },
        });
        if (existing) return;

        const item = await transaction.inventoryItem.findFirst({
          where: { id: itemId, organizationId: input.context.organizationId },
          select: { id: true, name: true, partNumber: true, quantityOnHand: true },
        });
        if (!item) return;

        // Reservations for this item and job count toward the line: the
        // hold is consumed first, the remainder comes off the shelf.
        const holds = await transaction.inventoryReservation.findMany({
          where: {
            organizationId: input.context.organizationId,
            inventoryItemId: item.id,
            workOrderId: invoice.workOrderId!,
            status: "ACTIVE",
          },
          orderBy: { createdAt: "asc" },
          select: { id: true, quantity: true },
        });
        const holdsTotal = holds.reduce((sum, hold) => sum + hold.quantity, 0);
        if (holdsTotal + item.quantityOnHand < invoiceQty) {
          // Never block, never go negative, no partial issues: flag the
          // discrepancy and leave the shop in charge.
          skippedLines += 1;
          await transaction.activityEvent.create({
            data: {
              id: randomUUID(),
              organizationId: input.context.organizationId,
              locationId: invoice.locationId,
              workOrderId: invoice.workOrderId!,
              actorUserId: input.context.actorId,
              eventType: "inventory.discrepancy",
              summary: `${item.partNumber} invoiced ×${invoiceQty} on ${invoice.number} but only ${holdsTotal + item.quantityOnHand} available (${item.quantityOnHand} on hand, ${holdsTotal} held) — count stock and issue by hand if needed.`,
            },
          });
          return;
        }

        // Consume holds first (fully, or shrink the last partial hold).
        let toTake = invoiceQty;
        for (const hold of holds) {
          if (toTake <= 0) break;
          const take = Math.min(hold.quantity, toTake);
          toTake -= take;
          if (take < hold.quantity) {
            await transaction.inventoryReservation.update({
              where: { id: hold.id },
              data: { quantity: hold.quantity - take },
            });
          } else {
            await transaction.inventoryReservation.update({
              where: { id: hold.id },
              data: { status: "CONSUMED", consumedAt: new Date() },
            });
          }
        }
        // Holds are an allocation over on-hand, not a removal: the full
        // invoiced quantity leaves the shelf now. If the count drifted
        // below the invoice (holds covered it), clamp at zero and flag.
        const shelfTake = Math.min(invoiceQty, item.quantityOnHand);
        if (shelfTake > 0) {
          await transaction.inventoryItem.update({
            where: { id: item.id },
            data: { quantityOnHand: item.quantityOnHand - shelfTake },
          });
        }
        if (item.quantityOnHand < invoiceQty) {
          await transaction.activityEvent.create({
            data: {
              id: randomUUID(),
              organizationId: input.context.organizationId,
              locationId: invoice.locationId,
              workOrderId: invoice.workOrderId!,
              actorUserId: input.context.actorId,
              eventType: "inventory.discrepancy",
              summary: `${item.partNumber} invoiced ×${invoiceQty} on ${invoice.number} but on-hand showed ${item.quantityOnHand} — count was short; corrected to zero.`,
            },
          });
        }

        // One consumption movement per invoice line.
        await recordStockMovement(transaction, input.context, {
          inventoryItemId: item.id,
          delta: -invoiceQty,
          reason: "ISSUED_TO_JOB",
          locationId: invoice.locationId,
          workOrderId: invoice.workOrderId!,
          invoiceLineId: line.id,
          note: `Issued on invoice ${invoice.number}`,
        });
        consumedLines += 1;
      });
    } catch {
      // Best effort: a failed line never fails the invoice.
      skippedLines += 1;
    }
  }

  return { consumedLines, skippedLines };
}
