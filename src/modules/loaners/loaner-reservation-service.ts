import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import { assertTenantAccess, type TenantContext } from "@/modules/tenancy/policy";

export type LoanerReservationInput = Readonly<{ db: PrismaClient; context: TenantContext }>;

type TransactionalClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$use" | "$extends"
>;

export class LoanerReservationFailed extends Error {
  constructor(
    public readonly reason:
      | "asset_not_found"
      | "asset_not_fleet"
      | "asset_already_out"
      | "asset_already_reserved"
      | "customer_not_found"
      | "work_order_not_found"
      | "reservation_not_found"
      | "not_reserved"
      | "invalid_window",
  ) {
    super("The loaner reservation could not be completed.");
    this.name = "LoanerReservationFailed";
  }
}

export type ReservationSummary = Readonly<{
  id: string;
  assetId: string;
  assetName: string;
  customerId: string;
  customerName: string;
  workOrderId: string | null;
  workOrderNumber: string | null;
  reservedFrom: Date;
  reservedTo: Date;
  status: string;
  note: string | null;
}>;

const SUMMARY_SELECT = {
  id: true,
  assetId: true,
  customerId: true,
  workOrderId: true,
  reservedFrom: true,
  reservedTo: true,
  status: true,
  note: true,
  asset: { select: { displayName: true } },
  customer: { select: { displayName: true } },
  workOrder: { select: { number: true } },
} as const;

function toSummary(row: {
  id: string;
  assetId: string;
  customerId: string;
  workOrderId: string | null;
  reservedFrom: Date;
  reservedTo: Date;
  status: string;
  note: string | null;
  asset: { displayName: string };
  customer: { displayName: string };
  workOrder: { number: string } | null;
}): ReservationSummary {
  return {
    id: row.id,
    assetId: row.assetId,
    assetName: row.asset.displayName,
    customerId: row.customerId,
    customerName: row.customer.displayName,
    workOrderId: row.workOrderId,
    workOrderNumber: row.workOrder?.number ?? null,
    reservedFrom: row.reservedFrom,
    reservedTo: row.reservedTo,
    status: row.status,
    note: row.note,
  };
}

async function assertAvailable(
  transaction: TransactionalClient,
  organizationId: string,
  assetId: string,
  from: Date,
  to: Date,
  ignoreReservationId?: string,
): Promise<void> {
  // A vehicle already out cannot be promised.
  const out = await transaction.loanerCheckout.findFirst({
    where: { organizationId, assetId, checkedInAt: null },
    select: { id: true },
  });
  if (out) throw new LoanerReservationFailed("asset_already_out");

  // Overlapping active reservations conflict (half-open windows touch cleanly).
  const overlapping = await transaction.loanerReservation.findFirst({
    where: {
      organizationId,
      assetId,
      status: "reserved",
      reservedFrom: { lt: to },
      reservedTo: { gt: from },
      ...(ignoreReservationId ? { id: { not: ignoreReservationId } } : {}),
    },
    select: { id: true },
  });
  if (overlapping) throw new LoanerReservationFailed("asset_already_reserved");
}

/**
 * Reserves a shop vehicle for a window — typically for an upcoming
 * appointment. Availability accounts for open checkouts and overlapping
 * reservations, so the same vehicle is never promised twice.
 */
export async function reserveLoaner(
  input: LoanerReservationInput & {
    assetId: string;
    customerId: string;
    locationId: string;
    workOrderId?: string;
    reservedFrom: Date;
    reservedTo: Date;
    note?: string;
  },
): Promise<Readonly<{ reservationId: string }>> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId, locationId: input.locationId },
    "work_orders.write",
  );

  if (!(input.reservedTo > input.reservedFrom)) {
    throw new LoanerReservationFailed("invalid_window");
  }

  return input.db.$transaction(async (transaction) => {
    const asset = await transaction.asset.findFirst({
      where: { id: input.assetId, organizationId: input.context.organizationId },
      select: { id: true, isFleetVehicle: true },
    });
    if (!asset) throw new LoanerReservationFailed("asset_not_found");
    if (!asset.isFleetVehicle) throw new LoanerReservationFailed("asset_not_fleet");

    const customer = await transaction.customer.findFirst({
      where: { id: input.customerId, organizationId: input.context.organizationId },
      select: { id: true },
    });
    if (!customer) throw new LoanerReservationFailed("customer_not_found");

    if (input.workOrderId) {
      const workOrder = await transaction.workOrder.findFirst({
        where: { id: input.workOrderId, organizationId: input.context.organizationId },
        select: { id: true },
      });
      if (!workOrder) throw new LoanerReservationFailed("work_order_not_found");
    }

    await assertAvailable(
      transaction,
      input.context.organizationId,
      input.assetId,
      input.reservedFrom,
      input.reservedTo,
    );

    const reservation = await transaction.loanerReservation.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        locationId: input.locationId,
        assetId: input.assetId,
        customerId: input.customerId,
        ...(input.workOrderId ? { workOrderId: input.workOrderId } : {}),
        reservedFrom: input.reservedFrom,
        reservedTo: input.reservedTo,
        ...(input.note ? { note: input.note.trim() } : {}),
        createdByUserId: input.context.actorId,
      },
      select: { id: true },
    });
    return { reservationId: reservation.id };
  });
}

/** Cancels a reservation, freeing the window. */
export async function cancelLoanerReservation(
  input: LoanerReservationInput & { reservationId: string },
): Promise<void> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );

  const cancelled = await input.db.loanerReservation.updateMany({
    where: {
      id: input.reservationId,
      organizationId: input.context.organizationId,
      status: "reserved",
    },
    data: { status: "cancelled" },
  });
  if (cancelled.count !== 1) throw new LoanerReservationFailed("not_reserved");
}

/**
 * Marks a reservation converted once the vehicle is checked out — called by
 * the loaner checkout flow so the window and the checkout agree.
 */
export async function convertReservation(
  db: PrismaClient | TransactionalClient,
  organizationId: string,
  assetId: string,
): Promise<void> {
  await db.loanerReservation.updateMany({
    where: {
      organizationId,
      assetId,
      status: "reserved",
      reservedFrom: { lte: new Date() },
      reservedTo: { gte: new Date() },
    },
    data: { status: "converted" },
  });
}

/** Upcoming and in-window reservations for the board. */
export async function listLoanerReservations(
  input: LoanerReservationInput & { from?: Date },
): Promise<readonly ReservationSummary[]> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.read",
  );

  const rows = await input.db.loanerReservation.findMany({
    where: {
      organizationId: input.context.organizationId,
      status: "reserved",
      ...(input.from ? { reservedTo: { gte: input.from } } : {}),
    },
    orderBy: { reservedFrom: "asc" },
    take: 100,
    select: SUMMARY_SELECT,
  });
  return rows.map(toSummary);
}
