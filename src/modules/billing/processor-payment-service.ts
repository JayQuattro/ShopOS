import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import { resolveDrawerForPayment } from "@/modules/billing/cash-drawer-service";

export type ProcessorWebhookOutcome =
  | { kind: "ignored"; reason: string }
  | { kind: "recorded"; invoiceId: string; amountMinor: number }
  | { kind: "duplicate"; invoiceId: string }
  | { kind: "error"; reason: string };

/**
 * Records a provider-confirmed payment from a verified webhook event. There
 * is no tenant actor here — the organization comes from the endpoint path
 * and the event payload is only trusted after adapter-level signature
 * verification. Recording mirrors the manual payment path: payment row,
 * invoice paid/status update, activity + audit events with the provider
 * reference as provenance. Idempotent on that reference.
 */
export async function recordStripeCheckoutCompleted(
  db: PrismaClient,
  organizationId: string,
  event: Readonly<{
    id: string;
    data: Readonly<{
      object: Readonly<{
        id: string;
        client_reference_id: string | null;
        payment_status: string;
        amount_total: number | null;
        currency: string | null;
        payment_intent?: string | null;
      }>;
    }>;
  }>,
): Promise<ProcessorWebhookOutcome> {
  const session = event.data.object;
  if (session.payment_status !== "paid") {
    return { kind: "ignored", reason: "payment_status_not_paid" };
  }
  const invoiceRef = session.client_reference_id;
  const amountMinor = session.amount_total ?? 0;
  if (!invoiceRef || amountMinor <= 0) {
    return { kind: "ignored", reason: "missing_reference_or_amount" };
  }

  return db.$transaction(async (transaction) => {
    // External processors have no staff actor; payments attribute to a
    // deterministic system user so provenance stays queryable.
    const systemUserId = (
      await transaction.user.upsert({
        where: { email: "system@shopos.internal" },
        update: {},
        create: {
          id: randomUUID(),
          email: "system@shopos.internal",
          emailVerified: true,
          displayName: "ShopOS (automated)",
        },
        select: { id: true },
      })
    ).id;
    // Scoped from the first query: the organization comes from the verified
    // endpoint path, never from the payload. Preferred match is the stored
    // link session; the fallback covers stale links the customer paid after
    // a newer link was issued — still org-scoped, still clamped to the
    // balance, and still idempotent on the provider reference.
    const invoice =
      (await transaction.invoice.findFirst({
        where: {
          id: invoiceRef,
          organizationId,
          paymentLinkRef: session.id,
        },
        select: {
          id: true,
          status: true,
          currency: true,
          totalMinor: true,
          paidMinor: true,
          locationId: true,
          workOrderId: true,
        },
      })) ??
      (await transaction.invoice.findFirst({
        where: { id: invoiceRef, organizationId },
        select: {
          id: true,
          status: true,
          currency: true,
          totalMinor: true,
          paidMinor: true,
          locationId: true,
          workOrderId: true,
        },
      }));
    if (!invoice) return { kind: "ignored", reason: "invoice_not_found" };
    if (invoice.status === "DRAFT" || invoice.status === "VOID") {
      return { kind: "ignored", reason: "invoice_not_payable" };
    }

    const sharedDrawerId = await resolveDrawerForPayment(
      transaction,
      organizationId,
      invoice.locationId,
      null,
    );

    // Idempotency: the provider reference is unique per session. A replayed
    // webhook must never double-pay.
    const providerRef = `stripe:${session.id}`;
    const existing = await transaction.payment.findFirst({
      where: { organizationId, invoiceId: invoice.id, reference: providerRef },
      select: { id: true },
    });
    if (existing) return { kind: "duplicate", invoiceId: invoice.id };

    const balance = invoice.totalMinor - invoice.paidMinor;
    const applied = amountMinor > Number(balance) ? Number(balance) : amountMinor;
    if (applied <= 0) return { kind: "ignored", reason: "already_settled" };

    await transaction.payment.create({
      data: {
        id: randomUUID(),
        organizationId,
        locationId: invoice.locationId,
        invoiceId: invoice.id,
        amountMinor: BigInt(applied),
        currency: invoice.currency,
        method: "CARD_EXTERNAL",
        reference: providerRef,
        ...(session.payment_intent ? { processorChargeId: session.payment_intent } : {}),
        // No staff actor: processor payments land in the shared drawer.
        ...(sharedDrawerId ? { drawerSessionId: sharedDrawerId } : {}),
        receivedAt: new Date(),
        recordedByUserId: systemUserId,
      },
    });

    const newPaid = invoice.paidMinor + BigInt(applied);
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
        organizationId,
        locationId: invoice.locationId,
        workOrderId: invoice.workOrderId,
        eventType: "payment.recorded",
        summary: `Card payment of ${applied} minor units confirmed by Stripe (${session.id}).`,
      },
    });

    await transaction.auditEvent.create({
      data: {
        id: randomUUID(),
        organizationId,
        locationId: invoice.locationId,
        action: "payment.processor_recorded",
        entityType: "invoice",
        entityId: invoice.id,
        requestId: providerRef,
        after: { amountMinor: applied, provider: "stripe", eventId: event.id, session: session.id },
      },
    });

    return { kind: "recorded", invoiceId: invoice.id, amountMinor: applied };
  });
}
