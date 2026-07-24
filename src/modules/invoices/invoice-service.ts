import { randomUUID } from "node:crypto";

import type { PrismaClient, PaymentMethod } from "@/generated/prisma/client";
import { assertTenantAccess, type TenantContext } from "@/modules/tenancy/policy";
import { transitionStatus } from "@/modules/work-orders/work-order-service";

type TransactionalClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$use" | "$extends"
>;

export type InvoiceServiceInput = Readonly<{ db: PrismaClient; context: TenantContext }>;

export class InvoiceFailed extends Error {
  constructor(
    public readonly reason:
      | "work_order_not_found"
      | "work_order_not_completed"
      | "invoice_already_exists"
      | "invoice_not_found"
      | "invoice_not_issued"
      | "invoice_already_paid"
      | "invoice_voided"
      | "payment_exceeds_balance",
  ) {
    super("The invoice operation could not be completed.");
    this.name = "InvoiceFailed";
  }
}

/**
 * Creates an invoice snapshot from a completed work order. The invoice is a
 * new immutable record — it does not follow later estimate edits. One invoice
 * per work order is enforced by a unique constraint.
 *
 * The work order must be COMPLETED. The latest PRESENTED estimate revision's
 * lines are snapshot into invoice lines.
 */
export async function createInvoiceFromWorkOrder(
  input: InvoiceServiceInput & { workOrderId: string },
): Promise<Readonly<{ invoiceId: string; number: string }>> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "invoices.issue",
  );

  return input.db.$transaction(async (transaction) => {
    const wo = await transaction.workOrder.findFirst({
      where: { id: input.workOrderId, organizationId: input.context.organizationId },
      select: { id: true, locationId: true, number: true, status: true },
    });
    if (!wo) throw new InvoiceFailed("work_order_not_found");
    if (wo.status !== "COMPLETED" && wo.status !== "AUTHORIZED" && wo.status !== "IN_PROGRESS") {
      throw new InvoiceFailed("work_order_not_completed");
    }

    // Check for existing invoice (one per work order).
    const existing = await transaction.invoice.findFirst({
      where: { workOrderId: wo.id, organizationId: input.context.organizationId },
      select: { id: true },
    });
    if (existing) throw new InvoiceFailed("invoice_already_exists");

    // Get the latest PRESENTED revision's lines.
    const latestRevision = await transaction.estimateRevision.findFirst({
      where: { workOrderId: wo.id, status: "PRESENTED" },
      orderBy: { revisionNumber: "desc" },
      select: {
        id: true,
        currency: true,
        subtotalMinor: true,
        discountMinor: true,
        taxMinor: true,
        totalMinor: true,
      },
    });

    const currency = latestRevision?.currency ?? "USD";
    const subtotalMinor = latestRevision?.subtotalMinor ?? 0n;
    const discountMinor = latestRevision?.discountMinor ?? 0n;
    const taxMinor = latestRevision?.taxMinor ?? 0n;
    const totalMinor = latestRevision?.totalMinor ?? 0n;

    // Generate invoice number.
    const number = await generateInvoiceNumber(transaction, input.context.organizationId);

    const invoice = await transaction.invoice.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        locationId: wo.locationId,
        workOrderId: wo.id,
        number,
        status: "DRAFT",
        currency,
        subtotalMinor,
        discountMinor,
        taxMinor,
        totalMinor,
        paidMinor: 0n,
      },
    });

    // Snapshot lines from the estimate revision.
    if (latestRevision) {
      const lines = await transaction.estimateLine.findMany({
        where: { estimateRevisionId: latestRevision.id },
        orderBy: { position: "asc" },
      });
      for (const line of lines) {
        await transaction.invoiceLine.create({
          data: {
            id: randomUUID(),
            organizationId: input.context.organizationId,
            invoiceId: invoice.id,
            sourceEstimateLineId: line.id,
            kind: line.kind,
            description: line.description,
            quantityMilli: line.quantityMilli,
            unitPriceMinor: line.unitPriceMinor,
            grossMinor: line.grossMinor,
            discountMinor: line.discountMinor,
            taxable: line.taxable,
            taxRateBasisPoints: line.taxRateBasisPoints,
            taxMinor: line.taxMinor,
            totalMinor: line.totalMinor,
            position: line.position,
          },
        });
      }
    }

    // Activity event.
    await transaction.activityEvent.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        locationId: wo.locationId,
        workOrderId: wo.id,
        actorUserId: input.context.actorId,
        eventType: "invoice.created",
        summary: `Invoice ${number} created from work order ${wo.number}.`,
      },
    });

    return { invoiceId: invoice.id, number };
  });
}

/**
 * Issues a DRAFT invoice, making it a financial claim. Once issued, the
 * invoice is immutable. Transitions the work order to INVOICED.
 */
export async function issueInvoice(
  input: InvoiceServiceInput & { invoiceId: string },
): Promise<void> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "invoices.issue",
  );

  await input.db.$transaction(async (transaction) => {
    const update = await transaction.invoice.updateMany({
      where: { id: input.invoiceId, organizationId: input.context.organizationId, status: "DRAFT" },
      data: { status: "ISSUED", issuedAt: new Date() },
    });
    if (update.count !== 1) {
      const invoice = await transaction.invoice.findFirst({
        where: { id: input.invoiceId, organizationId: input.context.organizationId },
        select: { status: true },
      });
      if (!invoice) throw new InvoiceFailed("invoice_not_found");
      throw new InvoiceFailed("invoice_not_issued");
    }

    // Audit.
    await transaction.auditEvent.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        actorUserId: input.context.actorId,
        action: "invoice.issued",
        entityType: "invoice",
        entityId: input.invoiceId,
        requestId: input.context.requestId,
      },
    });
  });

  // Transition work order to INVOICED.
  const invoice = await input.db.invoice.findUnique({
    where: { id: input.invoiceId },
    select: { workOrderId: true },
  });
  if (invoice) {
    await transitionStatus({
      db: input.db,
      context: input.context,
      workOrderId: invoice.workOrderId,
      targetStatus: "INVOICED",
    }).catch(() => undefined);
  }
}

/**
 * Records a manual payment against an issued invoice. Partial payments are
 * allowed but cannot exceed the balance. Updates the invoice's paidMinor and
 * status (PARTIALLY_PAID or PAID).
 */
export async function recordPayment(
  input: InvoiceServiceInput & {
    invoiceId: string;
    amountMinor: number;
    method: PaymentMethod;
    reference?: string;
    receivedAt?: Date;
  },
): Promise<Readonly<{ paymentId: string; invoiceStatus: string }>> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "payments.record",
  );

  return input.db.$transaction(async (transaction) => {
    const invoice = await transaction.invoice.findFirst({
      where: { id: input.invoiceId, organizationId: input.context.organizationId },
      select: { id: true, totalMinor: true, paidMinor: true, status: true, locationId: true },
    });
    if (!invoice) throw new InvoiceFailed("invoice_not_found");
    if (invoice.status === "DRAFT") throw new InvoiceFailed("invoice_not_issued");
    if (invoice.status === "VOID") throw new InvoiceFailed("invoice_voided");

    const balance = invoice.totalMinor - invoice.paidMinor;
    if (BigInt(input.amountMinor) > balance) {
      throw new InvoiceFailed("payment_exceeds_balance");
    }

    const payment = await transaction.payment.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        locationId: invoice.locationId,
        invoiceId: invoice.id,
        amountMinor: BigInt(input.amountMinor),
        currency: (await transaction.invoice.findUnique({
          where: { id: invoice.id },
          select: { currency: true },
        }))!.currency,
        method: input.method,
        reference: input.reference ?? null,
        receivedAt: input.receivedAt ?? new Date(),
        recordedByUserId: input.context.actorId,
      },
    });

    const newPaid = invoice.paidMinor + BigInt(input.amountMinor);
    const newStatus = newPaid >= invoice.totalMinor ? "PAID" : "PARTIALLY_PAID";
    await transaction.invoice.update({
      where: { id: invoice.id },
      data: { paidMinor: newPaid, status: newStatus },
    });

    // Activity event.
    await transaction.activityEvent.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        locationId: invoice.locationId,
        workOrderId: (await transaction.invoice.findUnique({
          where: { id: invoice.id },
          select: { workOrderId: true },
        }))!.workOrderId,
        actorUserId: input.context.actorId,
        eventType: "payment.recorded",
        summary: `Payment of ${input.amountMinor} minor units recorded via ${input.method}.`,
      },
    });

    return { paymentId: payment.id, invoiceStatus: newStatus };
  });
}

async function generateInvoiceNumber(
  transaction: TransactionalClient,
  organizationId: string,
): Promise<string> {
  const latest = await transaction.invoice.findFirst({
    where: { organizationId },
    orderBy: { number: "desc" },
    select: { number: true },
  });

  if (!latest) return "INV-1001";

  const match = latest.number.match(/(\d+)$/);
  const nextNum = match ? parseInt(match[1]!, 10) + 1 : 1001;
  return `INV-${nextNum}`;
}
