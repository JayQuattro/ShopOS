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
