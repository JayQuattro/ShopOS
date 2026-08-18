import { randomUUID } from "node:crypto";

import type { PrismaClient, PaymentMethod } from "@/generated/prisma/client";
import { assertTenantAccess, type TenantContext } from "@/modules/tenancy/policy";

export type DepositServiceInput = Readonly<{ db: PrismaClient; context: TenantContext }>;

export class DepositFailed extends Error {
  constructor(
    public readonly reason:
      | "work_order_not_found"
      | "invoice_not_found"
      | "invoice_not_issued"
      | "invoice_wrong_work_order"
      | "deposit_not_found"
      | "deposit_already_applied"
      | "deposit_exceeds_balance"
      | "invalid_amount",
  ) {
    super("The deposit operation could not be completed.");
    this.name = "DepositFailed";
  }
}

export type DepositSummary = Readonly<{
  id: string;
  workOrderId: string;
  workOrderNumber: string;
  customerName: string;
  amountMinor: bigint;
  currency: string;
  method: string;
  reference: string | null;
  receivedAt: Date;
  note: string | null;
  appliedInvoiceId: string | null;
  appliedAt: Date | null;
}>;

const SUMMARY_SELECT = {
  id: true,
  workOrderId: true,
  amountMinor: true,
  currency: true,
  method: true,
  reference: true,
  receivedAt: true,
  note: true,
  appliedInvoiceId: true,
  appliedAt: true,
  workOrder: { select: { number: true, customer: { select: { displayName: true } } } },
} as const;

type DepositRow = {
  id: string;
  workOrderId: string;
  amountMinor: bigint;
  currency: string;
  method: string;
  reference: string | null;
  receivedAt: Date;
  note: string | null;
  appliedInvoiceId: string | null;
  appliedAt: Date | null;
  workOrder: { number: string; customer: { displayName: string } };
};

function toSummary(row: DepositRow): DepositSummary {
  return {
    id: row.id,
    workOrderId: row.workOrderId,
    workOrderNumber: row.workOrder.number,
    customerName: row.workOrder.customer.displayName,
    amountMinor: row.amountMinor,
    currency: row.currency,
    method: row.method,
    reference: row.reference,
    receivedAt: row.receivedAt,
    note: row.note,
    appliedInvoiceId: row.appliedInvoiceId,
    appliedAt: row.appliedAt,
  };
}

/**
 * Takes a deposit at drop-off — money in hand before work starts. The deposit
 * sits open until the job's invoice is issued and it is applied.
 */
export async function recordDeposit(
  input: DepositServiceInput & {
    workOrderId: string;
    amountMinor: number;
    currency: string;
    method: PaymentMethod;
    reference?: string;
    note?: string;
  },
): Promise<Readonly<{ depositId: string }>> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "payments.record",
  );

  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new DepositFailed("invalid_amount");
  }

  return input.db.$transaction(async (transaction) => {
    const workOrder = await transaction.workOrder.findFirst({
      where: { id: input.workOrderId, organizationId: input.context.organizationId },
      select: { id: true, locationId: true },
    });
    if (!workOrder) throw new DepositFailed("work_order_not_found");

    const deposit = await transaction.deposit.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        locationId: workOrder.locationId,
        workOrderId: workOrder.id,
        amountMinor: BigInt(input.amountMinor),
        currency: input.currency.trim().toUpperCase(),
        method: input.method,
        ...(input.reference ? { reference: input.reference.trim() } : {}),
        receivedAt: new Date(),
        recordedByUserId: input.context.actorId,
        ...(input.note ? { note: input.note.trim() } : {}),
      },
      select: { id: true },
    });

    await transaction.activityEvent.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        locationId: workOrder.locationId,
        workOrderId: workOrder.id,
        actorUserId: input.context.actorId,
        eventType: "deposit.recorded",
        summary: `Deposit of ${input.amountMinor} minor units taken via ${input.method}.`,
      },
    });

    return { depositId: deposit.id };
  });
}

/**
 * Applies an open deposit to its work order's issued invoice: records the
 * payment (updating the invoice's paid amount and status, so AR and the cash
 * drawer stay truthful) and stamps the deposit as applied — atomically.
 */
export async function applyDeposit(
  input: DepositServiceInput & { depositId: string },
): Promise<Readonly<{ invoiceId: string }>> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "payments.record",
  );

  return input.db.$transaction(async (transaction) => {
    const deposit = await transaction.deposit.findFirst({
      where: { id: input.depositId, organizationId: input.context.organizationId },
      select: {
        id: true,
        workOrderId: true,
        amountMinor: true,
        currency: true,
        method: true,
        reference: true,
        appliedInvoiceId: true,
        receivedAt: true,
      },
    });
    if (!deposit) throw new DepositFailed("deposit_not_found");
    if (deposit.appliedInvoiceId) throw new DepositFailed("deposit_already_applied");

    const invoice = await transaction.invoice.findFirst({
      where: { workOrderId: deposit.workOrderId, organizationId: input.context.organizationId },
      select: {
        id: true,
        status: true,
        totalMinor: true,
        paidMinor: true,
        locationId: true,
        currency: true,
      },
    });
    if (!invoice) throw new DepositFailed("invoice_not_found");
    if (invoice.status === "DRAFT") throw new DepositFailed("invoice_not_issued");
    if (invoice.status === "VOID") throw new DepositFailed("invoice_not_issued");

    const balance = invoice.totalMinor - invoice.paidMinor;
    if (deposit.amountMinor > balance) {
      throw new DepositFailed("deposit_exceeds_balance");
    }

    // Claim the deposit first so a concurrent apply can't double-pay.
    const claimed = await transaction.deposit.updateMany({
      where: { id: deposit.id, appliedInvoiceId: null },
      data: { appliedInvoiceId: invoice.id, appliedAt: new Date() },
    });
    if (claimed.count !== 1) throw new DepositFailed("deposit_already_applied");

    await transaction.payment.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        locationId: invoice.locationId,
        invoiceId: invoice.id,
        amountMinor: deposit.amountMinor,
        currency: invoice.currency,
        method: deposit.method as PaymentMethod,
        ...(deposit.reference
          ? { reference: `deposit ${deposit.reference}` }
          : { reference: "deposit" }),
        receivedAt: deposit.receivedAt,
        recordedByUserId: input.context.actorId,
      },
    });

    const newPaid = invoice.paidMinor + deposit.amountMinor;
    await transaction.invoice.update({
      where: { id: invoice.id },
      data: {
        paidMinor: newPaid,
        status: newPaid >= invoice.totalMinor ? "PAID" : "PARTIALLY_PAID",
      },
    });

    await transaction.activityEvent.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        locationId: invoice.locationId,
        workOrderId: deposit.workOrderId,
        actorUserId: input.context.actorId,
        eventType: "deposit.applied",
        summary: `Deposit of ${deposit.amountMinor} minor units applied to the invoice.`,
      },
    });

    return { invoiceId: invoice.id };
  });
}

/** Money currently held: open deposits across the organization. */
export async function listOpenDeposits(
  input: DepositServiceInput,
): Promise<readonly DepositSummary[]> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "payments.record",
  );

  const where: Record<string, unknown> = {
    organizationId: input.context.organizationId,
    appliedAt: null,
  };
  if (!input.context.organizationWideLocationAccess && input.context.allowedLocationIds.size > 0) {
    where.locationId = { in: [...input.context.allowedLocationIds] };
  }

  const deposits = await input.db.deposit.findMany({
    where,
    orderBy: { receivedAt: "desc" },
    take: 100,
    select: SUMMARY_SELECT,
  });
  return deposits.map(toSummary);
}

export async function listDepositsForWorkOrder(
  input: DepositServiceInput & { workOrderId: string },
): Promise<readonly DepositSummary[]> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "payments.record",
  );

  const deposits = await input.db.deposit.findMany({
    where: { organizationId: input.context.organizationId, workOrderId: input.workOrderId },
    orderBy: { receivedAt: "desc" },
    select: SUMMARY_SELECT,
  });
  return deposits.map(toSummary);
}
