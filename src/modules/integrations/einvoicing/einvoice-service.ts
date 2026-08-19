import { createHash, randomUUID } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import { assertTenantAccess, type TenantContext } from "@/modules/tenancy/policy";
import {
  buildCrossIndustryInvoice,
  buildUblInvoice,
  type EInvoiceSource,
} from "@/modules/integrations/einvoicing/einvoice-formats";

export type EInvoiceServiceInput = Readonly<{ db: PrismaClient; context: TenantContext }>;

export class EInvoiceFailed extends Error {
  constructor(
    public readonly reason:
      "invoice_not_found" | "invoice_not_issued" | "no_format_configured" | "unsupported_format",
  ) {
    super("The e-invoice operation could not be completed.");
    this.name = "EInvoiceFailed";
  }
}

export type EInvoiceDocumentSummary = Readonly<{
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  format: string;
  contentHash: string;
  generatedAt: Date;
}>;

/**
 * Assembles the EN16931 source from an issued invoice and its stored
 * snapshots — tax mode, components, tax IDs — never live settings.
 */
type TransactionalClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$use" | "$extends"
>;

async function loadSource(
  transaction: PrismaClient | TransactionalClient,
  organizationId: string,
  invoiceId: string,
  format: EInvoiceSource["format"],
): Promise<EInvoiceSource> {
  const invoice = await transaction.invoice.findFirst({
    where: { id: invoiceId, organizationId },
    select: {
      number: true,
      issuedAt: true,
      currency: true,
      subtotalMinor: true,
      discountMinor: true,
      taxMinor: true,
      totalMinor: true,
      taxInclusive: true,
      lines: {
        orderBy: { position: "asc" },
        select: {
          description: true,
          quantityMilli: true,
          unitPriceMinor: true,
          grossMinor: true,
          discountMinor: true,
          taxable: true,
          taxRateBasisPoints: true,
          taxInclusive: true,
          taxComponents: true,
          totalMinor: true,
        },
      },
      workOrder: {
        select: {
          customer: {
            select: {
              displayName: true,
              taxId: true,
              addresses: {
                where: { isPrimary: true },
                take: 1,
                select: { line1: true, city: true, postalCode: true, country: true },
              },
            },
          },
        },
      },
      organization: {
        select: {
          name: true,
          taxId: true,
          addressLine1: true,
          city: true,
          postalCode: true,
          country: true,
        },
      },
    },
  });
  if (!invoice) throw new EInvoiceFailed("invoice_not_found");
  if (!invoice.issuedAt) throw new EInvoiceFailed("invoice_not_issued");

  // VAT breakdown by distinct rate, from the line snapshots. Stacked taxes
  // share one base so their components fold into per-rate buckets.
  const buckets = new Map<number, { basisMinor: bigint; amountMinor: bigint }>();
  for (const line of invoice.lines) {
    if (!line.taxable) continue;
    const components = Array.isArray(line.taxComponents)
      ? (line.taxComponents as unknown as EInvoiceSource["lines"][number]["taxComponents"])
      : [];
    const bucketsThisLine = components.length
      ? components
      : [{ name: "VAT", rateBasisPoints: line.taxRateBasisPoints }];
    for (const component of bucketsThisLine) {
      const basis = line.taxInclusive
        ? line.totalMinor -
          (line.totalMinor * BigInt(component.rateBasisPoints)) /
            BigInt(10000 + component.rateBasisPoints)
        : line.totalMinor;
      const taxAmount = (basis * BigInt(component.rateBasisPoints)) / 10000n;
      const bucket = buckets.get(component.rateBasisPoints) ?? { basisMinor: 0n, amountMinor: 0n };
      bucket.basisMinor += basis;
      bucket.amountMinor += taxAmount;
      buckets.set(component.rateBasisPoints, bucket);
    }
  }

  const buyerAddress = invoice.workOrder.customer.addresses[0];

  // Net (tax-exclusive) subtotal: the EN16931 tax basis. Inclusive
  // invoices carry tax inside their totals; the basis is total − tax.
  const netSubtotalMinor = invoice.taxInclusive
    ? invoice.totalMinor - invoice.taxMinor
    : invoice.subtotalMinor - invoice.discountMinor;

  return {
    format,
    invoiceNumber: invoice.number,
    issuedAt: invoice.issuedAt,
    currency: invoice.currency,
    netSubtotalMinor,
    discountMinor: invoice.discountMinor,
    taxMinor: invoice.taxMinor,
    grandMinor: invoice.totalMinor,
    vatBreakdown: [...buckets.entries()].map(([rateBasisPoints, bucket]) => ({
      rateBasisPoints,
      basisMinor: bucket.basisMinor,
      amountMinor: bucket.amountMinor,
    })),
    seller: {
      name: invoice.organization.name,
      taxId: invoice.organization.taxId,
      street: invoice.organization.addressLine1,
      city: invoice.organization.city,
      postalCode: invoice.organization.postalCode,
      country: invoice.organization.country,
    },
    buyer: {
      name: invoice.workOrder.customer.displayName,
      taxId: invoice.workOrder.customer.taxId,
      street: buyerAddress?.line1 ?? null,
      city: buyerAddress?.city ?? null,
      postalCode: buyerAddress?.postalCode ?? null,
      country: buyerAddress?.country ?? null,
    },
    lines: invoice.lines.map((line) => ({
      description: line.description,
      quantityMilli: line.quantityMilli,
      unitPriceMinor: line.unitPriceMinor,
      grossMinor: line.grossMinor,
      discountMinor: line.discountMinor,
      taxable: line.taxable,
      taxRateBasisPoints: line.taxRateBasisPoints,
      taxInclusive: line.taxInclusive,
      taxComponents: Array.isArray(line.taxComponents)
        ? (line.taxComponents as unknown as EInvoiceSource["lines"][number]["taxComponents"])
        : [],
      totalMinor: line.totalMinor,
    })),
  };
}

/**
 * Generates (or regenerates) the standard XML for an issued invoice in the
 * organization's configured format. The document snapshot is stored with a
 * content hash; regeneration audit-logs the replacement. The invoice
 * itself is never touched.
 */
export async function generateEInvoice(
  input: EInvoiceServiceInput & { invoiceId: string },
): Promise<EInvoiceDocumentSummary> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "invoices.issue",
  );

  return input.db.$transaction(async (transaction) => {
    const org = await transaction.organization.findUnique({
      where: { id: input.context.organizationId },
      select: { einvoiceFormat: true },
    });
    const format = org?.einvoiceFormat;
    if (format !== "factur-x" && format !== "xrechnung" && format !== "fatturapa") {
      throw new EInvoiceFailed("no_format_configured");
    }
    const source = await loadSource(
      transaction,
      input.context.organizationId,
      input.invoiceId,
      format,
    );

    const xml =
      format === "factur-x"
        ? buildCrossIndustryInvoice(source)
        : format === "xrechnung"
          ? buildUblInvoice(source)
          : (() => {
              throw new EInvoiceFailed("unsupported_format");
            })();
    const contentHash = createHash("sha256").update(xml).digest("hex");

    const before = await transaction.eInvoiceDocument.findFirst({
      where: { organizationId: input.context.organizationId, invoiceId: input.invoiceId },
      select: { id: true, contentHash: true },
    });

    const document = before
      ? await transaction.eInvoiceDocument.update({
          where: { id: before.id },
          data: {
            format,
            xml,
            contentHash,
            generatedByUserId: input.context.actorId,
            generatedAt: new Date(),
          },
          select: { id: true, invoiceId: true, format: true, contentHash: true, generatedAt: true },
        })
      : await transaction.eInvoiceDocument.create({
          data: {
            id: randomUUID(),
            organizationId: input.context.organizationId,
            invoiceId: input.invoiceId,
            format,
            xml,
            contentHash,
            generatedByUserId: input.context.actorId,
          },
          select: { id: true, invoiceId: true, format: true, contentHash: true, generatedAt: true },
        });

    const invoiceNumber = (
      await transaction.invoice.findUnique({
        where: { id: input.invoiceId },
        select: { number: true },
      })
    )?.number;

    await transaction.auditEvent.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        actorUserId: input.context.actorId,
        action: before ? "einvoice.regenerated" : "einvoice.generated",
        entityType: "invoice",
        entityId: input.invoiceId,
        requestId: input.context.requestId,
        ...(before ? { before: { contentHash: before.contentHash } } : {}),
        after: { format, contentHash },
      },
    });

    return { ...document, invoiceNumber: invoiceNumber ?? "" };
  });
}

export async function getEInvoiceDocument(
  input: EInvoiceServiceInput & { invoiceId: string },
): Promise<EInvoiceDocumentSummary & Readonly<{ xml: string; filename: string }>> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "invoices.issue",
  );

  const document = await input.db.eInvoiceDocument.findFirst({
    where: { organizationId: input.context.organizationId, invoiceId: input.invoiceId },
    orderBy: { generatedAt: "desc" },
  });
  if (!document) throw new EInvoiceFailed("invoice_not_found");

  const invoice = await input.db.invoice.findFirst({
    where: { id: input.invoiceId, organizationId: input.context.organizationId },
    select: { number: true },
  });

  const extension =
    document.format === "factur-x"
      ? "factur-x"
      : document.format === "xrechnung"
        ? "xrechnung"
        : "fatturapa";
  return {
    id: document.id,
    invoiceId: document.invoiceId,
    invoiceNumber: invoice?.number ?? "",
    format: document.format,
    contentHash: document.contentHash,
    generatedAt: document.generatedAt,
    xml: document.xml,
    filename: `${(invoice?.number ?? document.invoiceId).replace(/[^A-Za-z0-9-]/g, "_")}_${extension}.xml`,
  };
}
