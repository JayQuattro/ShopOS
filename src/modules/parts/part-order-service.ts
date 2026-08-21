import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import type { TransactionalClient } from "@/modules/estimates/estimate-service";
import { recordStockMovement } from "@/modules/inventory/inventory-service";
import { assertTenantAccess, type TenantContext } from "@/modules/tenancy/policy";

export type PartServiceInput = Readonly<{ db: PrismaClient; context: TenantContext }>;

export type PartOrderStatusValue = "REQUESTED" | "ORDERED" | "RECEIVED" | "CANCELLED";

export class PartOrderFailed extends Error {
  constructor(
    public readonly reason:
      | "work_order_not_found"
      | "supplier_not_found"
      | "duplicate_supplier_name"
      | "invalid_name"
      | "order_not_found"
      | "invalid_lines"
      | "line_not_in_order"
      | "invalid_receive_quantity"
      | "invalid_transition",
  ) {
    super("The parts operation could not be completed.");
    this.name = "PartOrderFailed";
  }
}

// ─── Suppliers ─────────────────────────────────────────────────────────────

export async function createSupplier(
  input: PartServiceInput & {
    name: string;
    phone?: string;
    email?: string;
    website?: string;
    notes?: string;
  },
): Promise<Readonly<{ supplierId: string }>> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );

  const name = input.name.trim();
  if (name.length < 2 || name.length > 180) throw new PartOrderFailed("invalid_name");

  const existing = await input.db.partSupplier.findFirst({
    where: { organizationId: input.context.organizationId, name },
    select: { id: true },
  });
  if (existing) throw new PartOrderFailed("duplicate_supplier_name");

  const supplier = await input.db.partSupplier.create({
    data: {
      id: randomUUID(),
      organizationId: input.context.organizationId,
      name,
      ...(input.phone ? { phone: input.phone.trim() } : {}),
      ...(input.email ? { email: input.email.trim() } : {}),
      ...(input.website ? { website: input.website.trim() } : {}),
      ...(input.notes ? { notes: input.notes.trim() } : {}),
    },
  });
  return { supplierId: supplier.id };
}

export async function listSuppliers(
  input: PartServiceInput,
): Promise<ReadonlyArray<Readonly<{ id: string; name: string; active: boolean }>>> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.read",
  );

  const suppliers = await input.db.partSupplier.findMany({
    where: { organizationId: input.context.organizationId },
    orderBy: { name: "asc" },
    select: { id: true, name: true, active: true },
  });
  return suppliers;
}

// ─── Part orders ───────────────────────────────────────────────────────────

export type PartOrderLineInput = Readonly<{
  description: string;
  partNumber?: string;
  /** Explicit inventory link — receiving bumps this item's stock. */
  inventoryItemId?: string;
  quantity: number;
  unitCostMinor: number;
}>;

/**
 * Creates a REQUESTED part order against a work order. Costs are integer
 * minor units in the organization's default currency; the source is MANUAL —
 * connector-placed orders will reconcile through the same shape (ADR 0015).
 */
export async function createPartOrder(
  input: PartServiceInput & {
    /** Required for JOB purpose; stock orders (REPLENISH/ALLOCATION) may omit it. */
    workOrderId?: string;
    supplierId: string;
    purpose?: "JOB" | "REPLENISH" | "ALLOCATION";
    lines: ReadonlyArray<PartOrderLineInput>;
    note?: string;
  },
): Promise<Readonly<{ partOrderId: string }>> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );

  if (input.lines.length === 0) throw new PartOrderFailed("invalid_lines");
  for (const line of input.lines) {
    if (
      line.description.trim().length < 2 ||
      !Number.isSafeInteger(line.quantity) ||
      line.quantity < 1 ||
      !Number.isSafeInteger(line.unitCostMinor) ||
      line.unitCostMinor < 0
    ) {
      throw new PartOrderFailed("invalid_lines");
    }
  }

  const purpose = input.purpose ?? "JOB";
  if (purpose === "JOB" && !input.workOrderId) throw new PartOrderFailed("invalid_lines");

  return input.db.$transaction(async (transaction) => {
    const workOrder = input.workOrderId
      ? await loadWorkOrder(transaction, input.context, input.workOrderId)
      : null;

    const supplier = await transaction.partSupplier.findFirst({
      where: { id: input.supplierId, organizationId: input.context.organizationId },
      select: { id: true, name: true },
    });
    if (!supplier) throw new PartOrderFailed("supplier_not_found");

    const org = await transaction.organization.findUnique({
      where: { id: input.context.organizationId },
      select: { defaultCurrency: true },
    });

    // Job orders inherit the work order's location; stock orders use the
    // caller's first allowed location (receiving scope), or the single
    // location for one-shop orgs.
    let locationId = workOrder?.locationId ?? null;
    if (!locationId) {
      const firstAllowed = [...input.context.allowedLocationIds][0];
      if (firstAllowed) {
        locationId = firstAllowed;
      } else {
        const anyLocation = await transaction.location.findFirst({
          where: { organizationId: input.context.organizationId, active: true },
          orderBy: { code: "asc" },
          select: { id: true },
        });
        locationId = anyLocation?.id ?? null;
      }
    }
    if (!locationId) throw new PartOrderFailed("invalid_lines");

    const partOrder = await transaction.partOrder.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        locationId,
        ...(workOrder ? { workOrderId: workOrder.id } : {}),
        supplierId: supplier.id,
        status: "REQUESTED",
        source: "MANUAL",
        purpose,
        currency: org?.defaultCurrency ?? "USD",
        ...(input.note ? { note: input.note.trim() } : {}),
        createdByUserId: input.context.actorId,
      },
    });

    for (const line of input.lines) {
      // An explicit inventory link makes receiving systematic — the line
      // knows which shelf to bump. Validated org-scoped.
      let inventoryItemId: string | undefined;
      if (line.inventoryItemId) {
        const item = await transaction.inventoryItem.findFirst({
          where: {
            id: line.inventoryItemId,
            organizationId: input.context.organizationId,
          },
          select: { id: true, partNumber: true },
        });
        if (!item) throw new PartOrderFailed("invalid_lines");
        inventoryItemId = item.id;
      }
      await transaction.partOrderLine.create({
        data: {
          id: randomUUID(),
          organizationId: input.context.organizationId,
          partOrderId: partOrder.id,
          description: line.description.trim(),
          ...(line.partNumber ? { partNumber: line.partNumber.trim() } : {}),
          ...(inventoryItemId ? { inventoryItemId } : {}),
          quantity: line.quantity,
          unitCostMinor: BigInt(line.unitCostMinor),
        },
      });
    }

    await recordActivity(transaction, input.context, {
      workOrderId: workOrder?.id ?? null,
      locationId,
      eventType: "parts.requested",
      summary: `Parts requested from ${supplier.name}: ${input.lines
        .map((line) => line.description.trim())
        .join(", ")}.`,
    });

    return { partOrderId: partOrder.id };
  });
}

/** Marks a requested order as placed with the supplier. */
export async function markOrdered(
  input: PartServiceInput & { partOrderId: string; trackingNumber?: string },
): Promise<void> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );

  await input.db.$transaction(async (transaction) => {
    const order = await loadPartOrder(transaction, input.context, input.partOrderId);
    if (order.status !== "REQUESTED") throw new PartOrderFailed("invalid_transition");

    await transaction.partOrder.update({
      where: { id: order.id },
      data: {
        status: "ORDERED",
        orderedAt: new Date(),
        ...(input.trackingNumber ? { trackingNumber: input.trackingNumber.trim() } : {}),
      },
    });

    await recordActivity(transaction, input.context, {
      workOrderId: order.workOrderId,
      locationId: order.locationId,
      eventType: "parts.ordered",
      summary: `Parts ordered from ${order.supplier.name}${
        input.trackingNumber ? ` (tracking ${input.trackingNumber.trim()})` : ""
      }.`,
    });
  });
}

export async function cancelPartOrder(
  input: PartServiceInput & { partOrderId: string },
): Promise<void> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );

  await input.db.$transaction(async (transaction) => {
    const order = await loadPartOrder(transaction, input.context, input.partOrderId);
    if (order.status !== "REQUESTED" && order.status !== "ORDERED") {
      throw new PartOrderFailed("invalid_transition");
    }

    await transaction.partOrder.update({
      where: { id: order.id },
      data: { status: "CANCELLED" },
    });

    await recordActivity(transaction, input.context, {
      workOrderId: order.workOrderId,
      locationId: order.locationId,
      eventType: "parts.cancelled",
      summary: `Parts order from ${order.supplier.name} cancelled.`,
    });
  });
}

/**
 * Receives quantities against an order's lines. The order completes when
 * every line is fully received.
 */
export async function receiveItems(
  input: PartServiceInput & {
    partOrderId: string;
    lines: ReadonlyArray<Readonly<{ lineId: string; quantity: number }>>;
  },
): Promise<Readonly<{ orderCompleted: boolean }>> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );

  if (input.lines.length === 0) throw new PartOrderFailed("invalid_lines");

  return input.db.$transaction(async (transaction) => {
    const order = await loadPartOrder(transaction, input.context, input.partOrderId);
    if (order.status !== "ORDERED") throw new PartOrderFailed("invalid_transition");

    const lineMap = new Map(order.lines.map((line) => [line.id, line]));
    const newlyReceivedDescriptions: string[] = [];

    for (const receipt of input.lines) {
      const line = lineMap.get(receipt.lineId);
      if (!line) throw new PartOrderFailed("line_not_in_order");
      if (
        !Number.isSafeInteger(receipt.quantity) ||
        receipt.quantity < 1 ||
        line.receivedQuantity + receipt.quantity > line.quantity
      ) {
        throw new PartOrderFailed("invalid_receive_quantity");
      }
      await transaction.partOrderLine.update({
        where: { id: line.id },
        data: { receivedQuantity: line.receivedQuantity + receipt.quantity },
      });
      // Systematic receiving: a linked line bumps its item's stock on
      // receipt — no separate "→ stock" step to remember. The movement row
      // keeps the audit trail of where the stock came from.
      if (line.inventoryItemId) {
        await transaction.inventoryItem.update({
          where: { id: line.inventoryItemId },
          data: { quantityOnHand: { increment: receipt.quantity } },
        });
        await recordStockMovement(transaction, input.context, {
          inventoryItemId: line.inventoryItemId,
          delta: receipt.quantity,
          reason: "RECEIVED",
          locationId: order.locationId,
          ...(order.workOrderId ? { workOrderId: order.workOrderId } : {}),
          partOrderLineId: line.id,
          note: `Received from ${order.supplier.name}`,
        });
      }
      newlyReceivedDescriptions.push(`${line.description} ×${receipt.quantity}`);
      lineMap.set(line.id, {
        ...line,
        receivedQuantity: line.receivedQuantity + receipt.quantity,
      });
    }

    const allReceived = [...lineMap.values()].every(
      (line) => line.receivedQuantity >= line.quantity,
    );

    if (allReceived) {
      await transaction.partOrder.update({
        where: { id: order.id },
        data: { status: "RECEIVED", receivedAt: new Date() },
      });
    }

    await recordActivity(transaction, input.context, {
      workOrderId: order.workOrderId,
      locationId: order.locationId,
      eventType: "parts.received",
      summary: `Parts received from ${order.supplier.name}: ${newlyReceivedDescriptions.join(", ")}${
        allReceived ? " — order complete." : "."
      }`,
    });

    return { orderCompleted: allReceived };
  });
}

export type PartOrderSummary = Readonly<{
  id: string;
  status: PartOrderStatusValue;
  source: "MANUAL" | "CONNECTOR";
  currency: string;
  trackingNumber: string | null;
  note: string | null;
  supplierName: string;
  orderedAt: Date | null;
  receivedAt: Date | null;
  totalCostMinor: string;
  lines: ReadonlyArray<
    Readonly<{
      id: string;
      description: string;
      partNumber: string | null;
      quantity: number;
      receivedQuantity: number;
      unitCostMinor: string;
    }>
  >;
}>;

export async function listPartOrders(
  input: PartServiceInput & { workOrderId: string },
): Promise<readonly PartOrderSummary[]> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.read",
  );

  const workOrder = await loadWorkOrder(input.db, input.context, input.workOrderId);

  const orders = await input.db.partOrder.findMany({
    where: { organizationId: input.context.organizationId, workOrderId: workOrder.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      source: true,
      currency: true,
      trackingNumber: true,
      note: true,
      orderedAt: true,
      receivedAt: true,
      supplier: { select: { name: true } },
      lines: { orderBy: { createdAt: "asc" } },
    },
  });

  return orders.map((order) => ({
    id: order.id,
    status: order.status as PartOrderStatusValue,
    source: order.source as "MANUAL" | "CONNECTOR",
    currency: order.currency,
    trackingNumber: order.trackingNumber,
    note: order.note,
    supplierName: order.supplier.name,
    orderedAt: order.orderedAt,
    receivedAt: order.receivedAt,
    totalCostMinor: order.lines
      .reduce((sum, line) => sum + line.unitCostMinor * BigInt(line.quantity), 0n)
      .toString(),
    lines: order.lines.map((line) => ({
      id: line.id,
      description: line.description,
      partNumber: line.partNumber,
      quantity: line.quantity,
      receivedQuantity: line.receivedQuantity,
      unitCostMinor: line.unitCostMinor.toString(),
    })),
  }));
}

// ─── Helpers ───────────────────────────────────────────────────────────────

async function loadWorkOrder(
  db: PrismaClient | TransactionalClient,
  context: TenantContext,
  workOrderId: string,
) {
  const workOrder = await db.workOrder.findFirst({
    where: { id: workOrderId, organizationId: context.organizationId },
    select: { id: true, locationId: true },
  });
  if (!workOrder) throw new PartOrderFailed("work_order_not_found");
  return workOrder;
}

async function loadPartOrder(
  transaction: TransactionalClient,
  context: TenantContext,
  partOrderId: string,
) {
  const order = await transaction.partOrder.findFirst({
    where: { id: partOrderId, organizationId: context.organizationId },
    select: {
      id: true,
      workOrderId: true,
      locationId: true,
      status: true,
      supplier: { select: { name: true } },
      lines: true,
    },
  });
  if (!order) throw new PartOrderFailed("order_not_found");
  return order;
}

async function recordActivity(
  transaction: TransactionalClient,
  context: TenantContext,
  input: Readonly<{
    workOrderId: string | null;
    locationId: string;
    eventType: string;
    summary: string;
  }>,
): Promise<void> {
  // Stock orders carry no work order — no activity event to hang them on.
  if (!input.workOrderId) return;
  await transaction.activityEvent.create({
    data: {
      id: randomUUID(),
      organizationId: context.organizationId,
      locationId: input.locationId,
      workOrderId: input.workOrderId,
      actorUserId: context.actorId,
      eventType: input.eventType,
      summary: input.summary,
    },
  });
}

// ─── Purchase history per item ──────────────────────────────────────────────

export type PurchaseRecord = Readonly<{
  orderedAt: Date | null;
  supplierName: string;
  quantity: number;
  unitCostMinor: string;
  currency: string;
  purpose: string;
}>;

/**
 * "Last bought X from Y": the item's purchase history across part orders —
 * explicit inventory links first, falling back to part-number matches for
 * lines ordered before the link existed.
 */
export async function listPurchaseHistory(
  input: PartServiceInput & {
    inventoryItemId: string;
  },
): Promise<readonly PurchaseRecord[]> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.read",
  );

  const item = await input.db.inventoryItem.findFirst({
    where: { id: input.inventoryItemId, organizationId: input.context.organizationId },
    select: { id: true, partNumber: true },
  });
  if (!item) throw new PartOrderFailed("order_not_found");

  const rows = await input.db.partOrderLine.findMany({
    where: {
      organizationId: input.context.organizationId,
      OR: [
        { inventoryItemId: item.id },
        ...(item.partNumber ? [{ partNumber: item.partNumber }] : []),
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      quantity: true,
      unitCostMinor: true,
      partOrder: {
        select: {
          orderedAt: true,
          currency: true,
          purpose: true,
          supplier: { select: { name: true } },
        },
      },
    },
  });

  return rows.map((row) => ({
    orderedAt: row.partOrder.orderedAt,
    supplierName: row.partOrder.supplier.name,
    quantity: row.quantity,
    unitCostMinor: row.unitCostMinor.toString(),
    currency: row.partOrder.currency,
    purpose: row.partOrder.purpose,
  }));
}

// ─── Waiting on vendors ─────────────────────────────────────────────────────

export type VendorWaitingGroup = Readonly<{
  supplierId: string;
  supplierName: string;
  orders: ReadonlyArray<
    Readonly<{
      orderId: string;
      status: string;
      purpose: string;
      orderedAt: Date | null;
      trackingNumber: string | null;
      workOrderNumber: string | null;
      lines: ReadonlyArray<
        Readonly<{
          description: string;
          partNumber: string | null;
          quantity: number;
          receivedQuantity: number;
        }>
      >;
    }>
  >;
}>;

/**
 * Everything waiting on every vendor: open (REQUESTED/ORDERED) orders
 * grouped by supplier, with per-line received progress and the job (when
 * the order is job-specific).
 */
export async function listWaitingByVendor(
  input: PartServiceInput,
): Promise<readonly VendorWaitingGroup[]> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.read",
  );

  const orders = await input.db.partOrder.findMany({
    where: {
      organizationId: input.context.organizationId,
      status: { in: ["REQUESTED", "ORDERED"] },
      ...(input.context.organizationWideLocationAccess
        ? {}
        : { locationId: { in: [...input.context.allowedLocationIds] } }),
    },
    orderBy: { createdAt: "asc" },
    take: 100,
    select: {
      id: true,
      status: true,
      purpose: true,
      orderedAt: true,
      trackingNumber: true,
      supplierId: true,
      supplier: { select: { name: true } },
      workOrder: { select: { number: true } },
      lines: {
        orderBy: { createdAt: "asc" },
        select: {
          description: true,
          partNumber: true,
          quantity: true,
          receivedQuantity: true,
        },
      },
    },
  });

  const groups = new Map<string, VendorWaitingGroup>();
  for (const order of orders) {
    const group = groups.get(order.supplierId) ?? {
      supplierId: order.supplierId,
      supplierName: order.supplier.name,
      orders: [],
    };
    const next = [
      ...group.orders,
      {
        orderId: order.id,
        status: order.status,
        purpose: order.purpose,
        orderedAt: order.orderedAt,
        trackingNumber: order.trackingNumber,
        workOrderNumber: order.workOrder?.number ?? null,
        lines: order.lines,
      },
    ];
    groups.set(order.supplierId, { ...group, orders: next });
  }
  return [...groups.values()];
}
