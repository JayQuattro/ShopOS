import type { PrismaClient } from "@/generated/prisma/client";
import { formatMoney } from "@/i18n/formatters";
import type { EventHandler, EventHandlerInput } from "@/modules/outbox/event-handler";
import { sendWorkOrderCustomerEmail } from "@/modules/notifications/send-work-order-customer-email";

export const INVOICE_ISSUED_EVENT = "invoice.issued";
export const PAYMENT_RECORDED_EVENT = "payment.recorded";

/** Default locale for customer email until per-customer locale preferences land (#60). */
const EMAIL_LOCALE = "en";

/**
 * Builds the invoice-issued email: a financial claim summary with the amount
 * due. Pure and unit-tested.
 */
export function buildInvoiceIssuedEmail(
  input: Readonly<{
    organizationName: string;
    workOrderNumber: string;
    invoiceNumber: string;
    totalMinor: string;
    currency: string;
  }>,
): Readonly<{ subject: string; text: string }> {
  const total = formatMoney(Number(input.totalMinor), input.currency, EMAIL_LOCALE);
  return {
    subject: `Invoice ${input.invoiceNumber} from ${input.organizationName}`,
    text: [
      `${input.organizationName} has issued invoice ${input.invoiceNumber} for work order ${input.workOrderNumber}.`,
      "",
      `Amount due: ${total}`,
      "",
      "Contact the shop to arrange payment or with any questions about this invoice.",
    ].join("\n"),
  };
}

/**
 * Builds the payment-receipt email. Pure and unit-tested.
 */
export function buildPaymentReceiptEmail(
  input: Readonly<{
    organizationName: string;
    workOrderNumber: string;
    invoiceNumber: string;
    amountMinor: string;
    remainingMinor: string;
    currency: string;
  }>,
): Readonly<{ subject: string; text: string }> {
  const money = (minor: string) => formatMoney(Number(minor), input.currency, EMAIL_LOCALE);
  const paidInFull = Number(input.remainingMinor) <= 0;
  return {
    subject: `Payment received — ${input.invoiceNumber} (${input.organizationName})`,
    text: [
      `${input.organizationName} received your payment of ${money(input.amountMinor)} on invoice ${input.invoiceNumber} (work order ${input.workOrderNumber}).`,
      "",
      paidInFull
        ? "This invoice is paid in full. Thank you!"
        : `Remaining balance: ${money(input.remainingMinor)}`,
      "",
      "Keep this email for your records.",
    ].join("\n"),
  };
}

/**
 * Emails the customer when an invoice is issued. The invoice is an immutable
 * financial record (ADR 0004); the email is a projection of it.
 */
export class InvoiceIssuedEmailHandler implements EventHandler {
  readonly eventType = INVOICE_ISSUED_EVENT;

  constructor(private readonly db: PrismaClient) {}

  async handle(input: EventHandlerInput): Promise<void> {
    const invoiceId = readString(input.event.data, "invoiceId");
    const workOrderId = readString(input.event.data, "workOrderId");
    const locationId = readString(input.event.data, "locationId");
    if (!invoiceId || !workOrderId || !locationId) {
      throw new Error("invoice.issued payload missing required fields");
    }
    const organizationId = input.event.organizationId;

    const invoice = await this.db.invoice.findFirst({
      where: { id: invoiceId, organizationId },
      select: {
        number: true,
        currency: true,
        totalMinor: true,
        organization: { select: { name: true } },
        workOrder: { select: { number: true } },
      },
    });
    if (!invoice) throw new Error("invoice not found for notification");

    const email = buildInvoiceIssuedEmail({
      organizationName: invoice.organization.name,
      workOrderNumber: invoice.workOrder.number,
      invoiceNumber: invoice.number,
      totalMinor: invoice.totalMinor.toString(),
      currency: invoice.currency,
    });

    await sendWorkOrderCustomerEmail(this.db, {
      organizationId,
      workOrderId,
      locationId,
      subject: email.subject,
      text: email.text,
      activityScope: "invoice",
    });
  }
}

/**
 * Emails the customer a receipt when a payment is recorded against an issued
 * invoice.
 */
export class PaymentRecordedEmailHandler implements EventHandler {
  readonly eventType = PAYMENT_RECORDED_EVENT;

  constructor(private readonly db: PrismaClient) {}

  async handle(input: EventHandlerInput): Promise<void> {
    const invoiceId = readString(input.event.data, "invoiceId");
    const workOrderId = readString(input.event.data, "workOrderId");
    const locationId = readString(input.event.data, "locationId");
    if (!invoiceId || !workOrderId || !locationId) {
      throw new Error("payment.recorded payload missing required fields");
    }
    const organizationId = input.event.organizationId;

    const invoice = await this.db.invoice.findFirst({
      where: { id: invoiceId, organizationId },
      select: {
        number: true,
        currency: true,
        totalMinor: true,
        paidMinor: true,
        organization: { select: { name: true } },
        workOrder: { select: { number: true } },
        payments: {
          orderBy: { receivedAt: "desc" },
          take: 1,
          select: { id: true, amountMinor: true },
        },
      },
    });
    if (!invoice) throw new Error("invoice not found for receipt");

    const payment = invoice.payments[0];
    if (!payment) throw new Error("payment not found for receipt");

    const email = buildPaymentReceiptEmail({
      organizationName: invoice.organization.name,
      workOrderNumber: invoice.workOrder.number,
      invoiceNumber: invoice.number,
      amountMinor: payment.amountMinor.toString(),
      remainingMinor: (invoice.totalMinor - invoice.paidMinor).toString(),
      currency: invoice.currency,
    });

    await sendWorkOrderCustomerEmail(this.db, {
      organizationId,
      workOrderId,
      locationId,
      subject: email.subject,
      text: email.text,
      activityScope: "payment",
    });
  }
}

function readString(data: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = data[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}
