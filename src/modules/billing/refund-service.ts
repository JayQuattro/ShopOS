import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import { resolvePaymentsAdapter } from "@/modules/integrations/payments/payments-connector-service";
import { assertTenantAccess, type TenantContext } from "@/modules/tenancy/policy";

export type RefundServiceInput = Readonly<{ db: PrismaClient; context: TenantContext }>;

export class RefundFailed extends Error {
  constructor(
    public readonly reason:
      | "payment_not_found"
      | "refund_exceeds_payment"
      | "invalid_amount"
      | "processor_refund_failed"
      | "processor_unavailable",
  ) {
    super("The refund could not be completed.");
    this.name = "RefundFailed";
  }
}

/**
 * Returns money against a payment. Payment rows stay immutable: the refund
 * is its own record, and the invoice's paid amount is tracked net of refunds
 * so AR balances stay truthful. Processor-charged payments are refunded
 * through the processor first (Stripe PaymentIntent); manual payments
 * (cash, check) refund at the counter with just a record.
 */
export async function refundPayment(
  input: RefundServiceInput & { paymentId: string; amountMinor?: number; reason?: string },
): Promise<Readonly<{ refundId: string; processorRefunded: boolean }>> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "payments.record",
  );

  if (
    input.amountMinor !== undefined &&
    (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0)
  ) {
    throw new RefundFailed("invalid_amount");
  }

  // Resolve the payment and its un-refunded remainder first.
  const payment = await input.db.payment.findFirst({
    where: { id: input.paymentId, organizationId: input.context.organizationId },
    select: {
      id: true,
      invoiceId: true,
      locationId: true,
      amountMinor: true,
      currency: true,
      method: true,
      processorChargeId: true,
      refunds: { select: { amountMinor: true } },
      invoice: { select: { workOrderId: true, status: true } },
    },
  });
  if (!payment) throw new RefundFailed("payment_not_found");

  const alreadyRefunded = payment.refunds.reduce((sum, refund) => sum + refund.amountMinor, 0n);
  const refundable = payment.amountMinor - alreadyRefunded;
  const amount = BigInt(input.amountMinor ?? Number(refundable));
  if (amount <= 0n || amount > refundable) {
    throw new RefundFailed("refund_exceeds_payment");
  }

  // Processor-charged money goes back through the processor first; nothing
  // is recorded unless the processor accepts the refund.
  let processorRef: string | null = null;
  let processorRefunded = false;
  if (payment.processorChargeId) {
    const adapter = await resolvePaymentsAdapter(input.db, input.context.organizationId);
    if (!adapter || typeof adapter.createRefund !== "function") {
      throw new RefundFailed("processor_unavailable");
    }
    try {
      const result = await adapter.createRefund({
        chargeId: payment.processorChargeId,
        amountMinor: Number(amount),
      });
      processorRef = result.refundId;
      processorRefunded = true;
    } catch {
      throw new RefundFailed("processor_refund_failed");
    }
  }

  return input.db.$transaction(async (transaction) => {
    const refund = await transaction.refund.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        locationId: payment.locationId,
        invoiceId: payment.invoiceId,
        paymentId: payment.id,
        amountMinor: amount,
        currency: payment.currency,
        ...(input.reason ? { reason: input.reason.trim() } : {}),
        ...(processorRef ? { providerRef: processorRef } : {}),
        refundedAt: new Date(),
        recordedByUserId: input.context.actorId,
      },
    });

    // Paid is net of refunds; status follows the net position.
    const invoice = await transaction.invoice.findUnique({
      where: { id: payment.invoiceId },
      select: { id: true, totalMinor: true, paidMinor: true },
    });
    if (invoice) {
      const newPaid = invoice.paidMinor - amount;
      await transaction.invoice.update({
        where: { id: invoice.id },
        data: {
          paidMinor: newPaid,
          status:
            newPaid >= invoice.totalMinor ? "PAID" : newPaid > 0n ? "PARTIALLY_PAID" : "ISSUED",
        },
      });
    }

    await transaction.activityEvent.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        locationId: payment.locationId,
        workOrderId: payment.invoice.workOrderId,
        actorUserId: input.context.actorId,
        eventType: "payment.refunded",
        summary: `Refund of ${amount} minor units against a ${payment.method.toLowerCase()} payment${processorRefunded ? " (via processor)" : ""}.`,
      },
    });

    await transaction.auditEvent.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        locationId: payment.locationId,
        actorUserId: input.context.actorId,
        action: "payment.refunded",
        entityType: "payment",
        entityId: payment.id,
        requestId: input.context.requestId,
        before: { paidMinor: invoice ? invoice.paidMinor.toString() : null },
        after: { refundMinor: amount.toString(), providerRefunded: processorRefunded },
      },
    });

    return { refundId: refund.id, processorRefunded };
  });
}

/** Payments on an invoice with their refundable remainders, newest first. */
export async function listRefundablePayments(
  input: RefundServiceInput & { invoiceId: string },
): Promise<
  readonly Readonly<{
    id: string;
    method: string;
    amountMinor: bigint;
    refundableMinor: bigint;
    reference: string | null;
    receivedAt: Date;
  }>[]
> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "payments.record",
  );

  const payments = await input.db.payment.findMany({
    where: { organizationId: input.context.organizationId, invoiceId: input.invoiceId },
    orderBy: { receivedAt: "desc" },
    select: {
      id: true,
      method: true,
      amountMinor: true,
      reference: true,
      receivedAt: true,
      refunds: { select: { amountMinor: true } },
    },
  });

  return payments.map((payment) => ({
    id: payment.id,
    method: payment.method,
    amountMinor: payment.amountMinor,
    refundableMinor:
      payment.amountMinor - payment.refunds.reduce((sum, refund) => sum + refund.amountMinor, 0n),
    reference: payment.reference,
    receivedAt: payment.receivedAt,
  }));
}
