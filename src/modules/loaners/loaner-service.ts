import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import { assertTenantAccess, type TenantContext } from "@/modules/tenancy/policy";

export type LoanerServiceInput = Readonly<{ db: PrismaClient; context: TenantContext }>;

export class LoanerFailed extends Error {
  constructor(
    public readonly reason:
      | "work_order_not_found"
      | "asset_not_found"
      | "checkout_not_found"
      | "asset_already_out"
      | "work_order_already_has_loaner"
      | "already_checked_in"
      | "invalid_mileage",
  ) {
    super("The loaner operation could not be completed.");
    this.name = "LoanerFailed";
  }
}

export type LoanerCheckoutSummary = Readonly<{
  id: string;
  workOrderId: string;
  assetId: string;
  assetName: string;
  customerName: string;
  checkedOutAt: Date;
  checkedInAt: Date | null;
  outMileage: number | null;
  inMileage: number | null;
  note: string | null;
}>;

/** Checks out a shop-owned asset as a loaner against a work order. */
export async function checkOutLoaner(
  input: LoanerServiceInput & {
    workOrderId: string;
    assetId: string;
    outMileage?: number;
    note?: string;
  },
): Promise<Readonly<{ checkoutId: string }>> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );

  if (
    input.outMileage !== undefined &&
    (!Number.isSafeInteger(input.outMileage) || input.outMileage < 0)
  ) {
    throw new LoanerFailed("invalid_mileage");
  }

  return input.db.$transaction(async (transaction) => {
    const workOrder = await transaction.workOrder.findFirst({
      where: { id: input.workOrderId, organizationId: input.context.organizationId },
      select: { id: true, locationId: true },
    });
    if (!workOrder) throw new LoanerFailed("work_order_not_found");

    const asset = await transaction.asset.findFirst({
      where: { id: input.assetId, organizationId: input.context.organizationId },
      select: { id: true, customerId: true },
    });
    if (!asset) throw new LoanerFailed("asset_not_found");

    // The loaner must not itself be out with someone else.
    const openOnAsset = await transaction.loanerCheckout.findFirst({
      where: { organizationId: input.context.organizationId, assetId: asset.id, checkedInAt: null },
      select: { id: true },
    });
    if (openOnAsset) throw new LoanerFailed("asset_already_out");

    // One active loaner per work order keeps the record unambiguous.
    const openOnWorkOrder = await transaction.loanerCheckout.findFirst({
      where: {
        organizationId: input.context.organizationId,
        workOrderId: workOrder.id,
        checkedInAt: null,
      },
      select: { id: true },
    });
    if (openOnWorkOrder) throw new LoanerFailed("work_order_already_has_loaner");

    const checkout = await transaction.loanerCheckout.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        locationId: workOrder.locationId,
        workOrderId: workOrder.id,
        assetId: asset.id,
        ...(input.outMileage !== undefined ? { outMileage: input.outMileage } : {}),
        ...(input.note ? { note: input.note.trim() } : {}),
      },
    });

    await transaction.activityEvent.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        locationId: workOrder.locationId,
        workOrderId: workOrder.id,
        actorUserId: input.context.actorId,
        eventType: "loaner.checked_out",
        summary: `Loaner checked out${input.outMileage !== undefined ? ` at ${input.outMileage} mi` : ""}.`,
      },
    });

    return { checkoutId: checkout.id };
  });
}

/** Returns a loaner, recording mileage for billing/damage disputes. */
export async function checkInLoaner(
  input: LoanerServiceInput & { checkoutId: string; inMileage?: number },
): Promise<void> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );

  if (
    input.inMileage !== undefined &&
    (!Number.isSafeInteger(input.inMileage) || input.inMileage < 0)
  ) {
    throw new LoanerFailed("invalid_mileage");
  }

  await input.db.$transaction(async (transaction) => {
    const checkout = await transaction.loanerCheckout.findFirst({
      where: { id: input.checkoutId, organizationId: input.context.organizationId },
      select: { id: true, checkedInAt: true, workOrderId: true, locationId: true },
    });
    if (!checkout) throw new LoanerFailed("checkout_not_found");
    if (checkout.checkedInAt) throw new LoanerFailed("already_checked_in");

    await transaction.loanerCheckout.update({
      where: { id: checkout.id },
      data: {
        checkedInAt: new Date(),
        ...(input.inMileage !== undefined ? { inMileage: input.inMileage } : {}),
      },
    });

    await transaction.activityEvent.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        locationId: checkout.locationId,
        workOrderId: checkout.workOrderId,
        actorUserId: input.context.actorId,
        eventType: "loaner.checked_in",
        summary: `Loaner returned${input.inMileage !== undefined ? ` at ${input.inMileage} mi` : ""}.`,
      },
    });
  });
}

/** The org's open loaners (fleet board), newest first. */
export async function listOpenLoaners(
  input: LoanerServiceInput,
): Promise<readonly LoanerCheckoutSummary[]> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.read",
  );

  const checkouts = await input.db.loanerCheckout.findMany({
    where: { organizationId: input.context.organizationId, checkedInAt: null },
    orderBy: { checkedOutAt: "desc" },
    take: 50,
    select: {
      id: true,
      workOrderId: true,
      assetId: true,
      checkedOutAt: true,
      checkedInAt: true,
      outMileage: true,
      inMileage: true,
      note: true,
      asset: { select: { displayName: true, customer: { select: { displayName: true } } } },
      workOrder: { select: { number: true, customer: { select: { displayName: true } } } },
    },
  });

  return checkouts.map((checkout) => ({
    id: checkout.id,
    workOrderId: checkout.workOrderId,
    assetId: checkout.assetId,
    assetName: checkout.asset.displayName,
    customerName: checkout.workOrder.customer.displayName,
    checkedOutAt: checkout.checkedOutAt,
    checkedInAt: checkout.checkedInAt,
    outMileage: checkout.outMileage,
    inMileage: checkout.inMileage,
    note: checkout.note,
  }));
}

/** Full loaner history for one work order. */
export async function listLoanersForWorkOrder(
  input: LoanerServiceInput & { workOrderId: string },
): Promise<readonly LoanerCheckoutSummary[]> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.read",
  );

  const checkouts = await input.db.loanerCheckout.findMany({
    where: { organizationId: input.context.organizationId, workOrderId: input.workOrderId },
    orderBy: { checkedOutAt: "desc" },
    select: {
      id: true,
      workOrderId: true,
      assetId: true,
      checkedOutAt: true,
      checkedInAt: true,
      outMileage: true,
      inMileage: true,
      note: true,
      asset: { select: { displayName: true } },
      workOrder: { select: { customer: { select: { displayName: true } } } },
    },
  });

  return checkouts.map((checkout) => ({
    id: checkout.id,
    workOrderId: checkout.workOrderId,
    assetId: checkout.assetId,
    assetName: checkout.asset.displayName,
    customerName: checkout.workOrder.customer.displayName,
    checkedOutAt: checkout.checkedOutAt,
    checkedInAt: checkout.checkedInAt,
    outMileage: checkout.outMileage,
    inMileage: checkout.inMileage,
    note: checkout.note,
  }));
}
