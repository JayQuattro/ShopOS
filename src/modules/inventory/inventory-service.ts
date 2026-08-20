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
