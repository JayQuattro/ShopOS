import { randomUUID } from "node:crypto";

import type { PaymentMethod, PricedLineKind, PrismaClient } from "@/generated/prisma/client";
import { resolveDrawerForPayment } from "@/modules/billing/cash-drawer-service";
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
      | "invalid_tenders"
      | "payment_exceeds_balance"
      | "change_order_pending",
  ) {
    super("The invoice operation could not be completed.");
    this.name = "InvoiceFailed";
  }
}

/**
 * Creates an invoice snapshot from a work order. The invoice is a new
 * immutable record — it does not follow later estimate edits. One invoice per
 * work order is enforced by a unique constraint.
 *
 * Lines are assembled from the cumulative authorized scope (ADR 0014): the
 * latest PRESENTED baseline revision plus every PRESENTED change order.
 * Under the organization's default `invoiceLinePolicy` (APPROVED_ONLY) only
 * lines the customer approved are billed; ALL_LINES preserves the legacy
 * copy-everything behavior. Invoice totals are recomputed from the selected
 * lines — credit lines contribute negative amounts.
 *
 * No invoice may be created while a change order is still undecided.
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

    const pendingChangeOrder = await transaction.estimateRevision.findFirst({
      where: {
        organizationId: input.context.organizationId,
        workOrderId: wo.id,
        documentKind: "CHANGE_ORDER",
        status: "PRESENTED",
        lines: { some: { authorizationDecisions: { none: {} } } },
      },
      select: { id: true },
    });
    if (pendingChangeOrder) throw new InvoiceFailed("change_order_pending");

    // Check for existing invoice (one per work order).
    const existing = await transaction.invoice.findFirst({
      where: { workOrderId: wo.id, organizationId: input.context.organizationId },
      select: { id: true },
    });
    if (existing) throw new InvoiceFailed("invoice_already_exists");

    const org = await transaction.organization.findUnique({
      where: { id: input.context.organizationId },
      select: { invoiceLinePolicy: true },
    });
    const approvedOnly = org?.invoiceLinePolicy !== "ALL_LINES";

    // Baseline: the latest PRESENTED baseline revision.
    const baseline = await transaction.estimateRevision.findFirst({
      where: {
        workOrderId: wo.id,
        organizationId: input.context.organizationId,
        documentKind: "BASELINE",
        status: "PRESENTED",
      },
      orderBy: { revisionNumber: "desc" },
      select: { id: true, currency: true },
    });
    // Change orders: every PRESENTED change order, oldest first.
    const changeOrders = await transaction.estimateRevision.findMany({
      where: {
        workOrderId: wo.id,
        organizationId: input.context.organizationId,
        documentKind: "CHANGE_ORDER",
        status: "PRESENTED",
      },
      orderBy: { changeOrderNumber: "asc" },
      select: { id: true },
    });

    const sourceRevisionIds = [
      ...(baseline ? [baseline.id] : []),
      ...changeOrders.map((co) => co.id),
    ];

    type SourceLine = {
      id: string;
      kind: PricedLineKind;
      description: string;
      quantityMilli: number;
      unitPriceMinor: bigint;
      grossMinor: bigint;
      discountMinor: bigint;
      taxable: boolean;
      taxRateBasisPoints: number;
      taxMinor: bigint;
      totalMinor: bigint;
      position: number;
      approved: boolean;
    };
    const sourceLines: SourceLine[] = [];

    for (const revisionId of sourceRevisionIds) {
      const lines = await transaction.estimateLine.findMany({
        where: { estimateRevisionId: revisionId },
        orderBy: { position: "asc" },
        include: {
          authorizationDecisions: { select: { decision: true }, take: 1 },
        },
      });
      for (const line of lines) {
        sourceLines.push({
          id: line.id,
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
          // Mirrors the money kernel: approved or authorization-not-required.
          approved:
            line.authorizationDecisions[0]?.decision === "APPROVED" || !line.authorizationRequired,
        });
      }
    }

    const selectedLines = approvedOnly ? sourceLines.filter((line) => line.approved) : sourceLines;

    let subtotalMinor = 0n;
    let discountMinor = 0n;
    let taxMinor = 0n;
    let totalMinor = 0n;
    for (const line of selectedLines) {
      subtotalMinor += line.grossMinor;
      discountMinor += line.discountMinor;
      taxMinor += line.taxMinor;
      totalMinor += line.totalMinor;
    }

    const currency = baseline?.currency ?? "USD";

    // Generate invoice number.
    const number = await generateInvoiceNumber(
      transaction,
      input.context.organizationId,
      wo.locationId,
    );

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

    // Snapshot the selected lines with renumbered invoice positions.
    let invoicePosition = 0;
    for (const line of selectedLines) {
      invoicePosition += 1;
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
          position: invoicePosition,
        },
      });
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
        summary: `Invoice ${number} created from work order ${wo.number}${approvedOnly ? " (approved lines only)" : ""}.`,
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

    const issued = await transaction.invoice.findUnique({
      where: { id: input.invoiceId },
      select: { workOrderId: true, locationId: true },
    });

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

    // Customer notification via the outbox.
    if (issued) {
      await transaction.outboxEvent.create({
        data: {
          id: randomUUID(),
          organizationId: input.context.organizationId,
          eventType: "invoice.issued",
          aggregateType: "invoice",
          aggregateId: input.invoiceId,
          payload: {
            invoiceId: input.invoiceId,
            workOrderId: issued.workOrderId,
            locationId: issued.locationId,
          },
        },
      });
    }
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

  return input.db
    .$transaction(async (transaction) => {
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

      const drawerSessionId = await resolveDrawerForPayment(
        transaction,
        input.context.organizationId,
        invoice.locationId,
        input.context.actorId,
      );
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
          ...(drawerSessionId ? { drawerSessionId } : {}),
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

      const workOrderRef = await transaction.invoice.findUnique({
        where: { id: invoice.id },
        select: { workOrderId: true },
      });

      // Activity event.
      await transaction.activityEvent.create({
        data: {
          id: randomUUID(),
          organizationId: input.context.organizationId,
          locationId: invoice.locationId,
          workOrderId: workOrderRef!.workOrderId,
          actorUserId: input.context.actorId,
          eventType: "payment.recorded",
          summary: `Payment of ${input.amountMinor} minor units recorded via ${input.method}.`,
        },
      });

      // Customer receipt via the outbox.
      await transaction.outboxEvent.create({
        data: {
          id: randomUUID(),
          organizationId: input.context.organizationId,
          eventType: "payment.recorded",
          aggregateType: "payment",
          aggregateId: payment.id,
          payload: {
            invoiceId: invoice.id,
            workOrderId: workOrderRef!.workOrderId,
            locationId: invoice.locationId,
          },
        },
      });

      return { paymentId: payment.id, invoiceStatus: newStatus };
    })
    .then(async (result) => {
      // If the invoice is now fully paid, transition the work order to CLOSED.
      if (result.invoiceStatus === "PAID") {
        const invoice = await input.db.invoice.findUnique({
          where: { id: input.invoiceId },
          select: { workOrderId: true },
        });
        if (invoice) {
          await transitionStatus({
            db: input.db,
            context: input.context,
            workOrderId: invoice.workOrderId,
            targetStatus: "CLOSED",
          }).catch(() => undefined);
        }
      }
      return result;
    });
}

/**
 * Records a split-tender payment — several methods settling one balance in a
 * single atomic transaction (e.g. $150 card + $50 cash at pickup). Same rules
 * as single payments: partial allowed, the combined tenders may not exceed
 * the balance, and full settlement closes the work order.
 */
export async function recordPaymentTenders(
  input: InvoiceServiceInput & {
    invoiceId: string;
    tenders: ReadonlyArray<
      Readonly<{ amountMinor: number; method: PaymentMethod; reference?: string }>
    >;
    receivedAt?: Date;
  },
): Promise<Readonly<{ paymentIds: string[]; invoiceStatus: string }>> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "payments.record",
  );

  if (input.tenders.length === 0 || input.tenders.length > 10) {
    throw new InvoiceFailed("invalid_tenders");
  }
  for (const tender of input.tenders) {
    if (!Number.isSafeInteger(tender.amountMinor) || tender.amountMinor <= 0) {
      throw new InvoiceFailed("invalid_tenders");
    }
  }

  const result = await input.db.$transaction(async (transaction) => {
    const invoice = await transaction.invoice.findFirst({
      where: { id: input.invoiceId, organizationId: input.context.organizationId },
      select: {
        id: true,
        totalMinor: true,
        paidMinor: true,
        status: true,
        locationId: true,
        currency: true,
        workOrderId: true,
      },
    });
    if (!invoice) throw new InvoiceFailed("invoice_not_found");
    if (invoice.status === "DRAFT") throw new InvoiceFailed("invoice_not_issued");
    if (invoice.status === "VOID") throw new InvoiceFailed("invoice_voided");

    const balance = invoice.totalMinor - invoice.paidMinor;
    const total = BigInt(input.tenders.reduce((sum, tender) => sum + tender.amountMinor, 0));
    if (total > balance) {
      throw new InvoiceFailed("payment_exceeds_balance");
    }

    const drawerSessionId = await resolveDrawerForPayment(
      transaction,
      input.context.organizationId,
      invoice.locationId,
      input.context.actorId,
    );
    const paymentIds: string[] = [];
    for (const tender of input.tenders) {
      const payment = await transaction.payment.create({
        data: {
          id: randomUUID(),
          organizationId: input.context.organizationId,
          locationId: invoice.locationId,
          invoiceId: invoice.id,
          amountMinor: BigInt(tender.amountMinor),
          currency: invoice.currency,
          method: tender.method,
          reference: tender.reference ?? null,
          ...(drawerSessionId ? { drawerSessionId } : {}),
          receivedAt: input.receivedAt ?? new Date(),
          recordedByUserId: input.context.actorId,
        },
      });
      paymentIds.push(payment.id);

      await transaction.activityEvent.create({
        data: {
          id: randomUUID(),
          organizationId: input.context.organizationId,
          locationId: invoice.locationId,
          workOrderId: invoice.workOrderId,
          actorUserId: input.context.actorId,
          eventType: "payment.recorded",
          summary: `Payment of ${tender.amountMinor} minor units recorded via ${tender.method}.`,
        },
      });

      await transaction.outboxEvent.create({
        data: {
          id: randomUUID(),
          organizationId: input.context.organizationId,
          eventType: "payment.recorded",
          aggregateType: "payment",
          aggregateId: payment.id,
          payload: {
            invoiceId: invoice.id,
            workOrderId: invoice.workOrderId,
            locationId: invoice.locationId,
          },
        },
      });
    }

    const newPaid = invoice.paidMinor + total;
    const newStatus = newPaid >= invoice.totalMinor ? "PAID" : "PARTIALLY_PAID";
    await transaction.invoice.update({
      where: { id: invoice.id },
      data: { paidMinor: newPaid, status: newStatus },
    });

    return { paymentIds, invoiceStatus: newStatus, workOrderId: invoice.workOrderId };
  });

  if (result.invoiceStatus === "PAID") {
    await transitionStatus({
      db: input.db,
      context: input.context,
      workOrderId: result.workOrderId,
      targetStatus: "CLOSED",
    }).catch(() => undefined);
  }

  return result;
}

/**
 * Gapless per-establishment series (legal requirement in much of the EU):
 * each location numbers from its own sequence — the location's prefix when
 * set, otherwise the organization's — and numbers are unique per
 * (organization, location), so two locations may both issue INV-1001.
 */
async function generateInvoiceNumber(
  transaction: TransactionalClient,
  organizationId: string,
  locationId: string,
): Promise<string> {
  const [org, location] = await Promise.all([
    transaction.organization.findUnique({
      where: { id: organizationId },
      select: { invoiceNumberPrefix: true },
    }),
    transaction.location.findFirst({
      where: { id: locationId, organizationId },
      select: { invoiceNumberPrefix: true },
    }),
  ]);
  const prefix = location?.invoiceNumberPrefix ?? org?.invoiceNumberPrefix ?? "INV-";

  const latest = await transaction.invoice.findFirst({
    where: { organizationId, locationId, number: { startsWith: prefix } },
    orderBy: { number: "desc" },
    select: { number: true },
  });

  if (!latest) return `${prefix}1001`;

  const match = latest.number.match(/(\d+)$/);
  const nextNum = match ? parseInt(match[1]!, 10) + 1 : 1001;
  return `${prefix}${nextNum}`;
}
