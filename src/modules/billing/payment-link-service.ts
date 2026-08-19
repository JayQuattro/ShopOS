import type { PrismaClient } from "@/generated/prisma/client";
import { resolvePaymentsAdapter } from "@/modules/integrations/payments/payments-connector-service";
import { assertTenantAccess, type TenantContext } from "@/modules/tenancy/policy";

export type PaymentLinkServiceInput = Readonly<{ db: PrismaClient; context: TenantContext }>;

export class PaymentLinkFailed extends Error {
  constructor(
    public readonly reason:
      | "invoice_not_found"
      | "invoice_not_issued"
      | "invoice_already_paid"
      | "no_processor"
      | "provider_error",
  ) {
    super("The payment link operation could not be completed.");
    this.name = "PaymentLinkFailed";
  }
}

/**
 * Creates a hosted payment link for an invoice's remaining balance through
 * the organization's own processor (ADR 0016). The link is a projection on
 * the invoice; amounts always come from the invoice, never the link.
 */
export async function createInvoicePaymentLink(
  input: PaymentLinkServiceInput & { invoiceId: string; returnUrl: string },
): Promise<Readonly<{ url: string }>> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "invoices.issue",
  );

  const invoice = await input.db.invoice.findFirst({
    where: { id: input.invoiceId, organizationId: input.context.organizationId },
    select: {
      id: true,
      number: true,
      status: true,
      currency: true,
      totalMinor: true,
      paidMinor: true,
      paymentUrl: true,
    },
  });
  if (!invoice) throw new PaymentLinkFailed("invoice_not_found");
  if (invoice.status === "DRAFT" || invoice.status === "VOID") {
    throw new PaymentLinkFailed("invoice_not_issued");
  }
  const balance = invoice.totalMinor - invoice.paidMinor;
  if (balance <= 0n) throw new PaymentLinkFailed("invoice_already_paid");

  const adapter = await resolvePaymentsAdapter(input.db, input.context.organizationId);
  if (!adapter) throw new PaymentLinkFailed("no_processor");

  let link;
  try {
    link = await adapter.createPaymentLink({
      amountMinor: Number(balance),
      currency: invoice.currency,
      description: `Invoice ${invoice.number}`,
      reference: invoice.id,
      returnUrl: input.returnUrl,
    });
  } catch {
    throw new PaymentLinkFailed("provider_error");
  }

  await input.db.invoice.update({
    where: { id: invoice.id },
    data: { paymentUrl: link.url, paymentLinkRef: link.providerRef },
  });

  return { url: link.url };
}
