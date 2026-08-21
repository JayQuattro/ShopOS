import type { PrismaClient } from "@/generated/prisma/client";
import { assertTenantAccess, type TenantContext } from "@/modules/tenancy/policy";

export type WarrantyServiceInput = Readonly<{ db: PrismaClient; context: TenantContext }>;

export class WarrantyFailed extends Error {
  constructor(public readonly reason: "invoice_not_found" | "invoice_not_draft" | "invalid_terms") {
    super("The warranty operation could not be completed.");
    this.name = "WarrantyFailed";
  }
}

/**
 * Sets or clears warranty terms on a DRAFT invoice. Terms default from the
 * organization at creation; the writer can adjust or clear them until the
 * invoice is issued, then they freeze with the document.
 */
export async function setInvoiceWarranty(
  input: WarrantyServiceInput & {
    invoiceId: string;
    warrantyMonths?: number | null;
    warrantyMiles?: number | null;
  },
): Promise<Readonly<{ warrantyMonths: number | null; warrantyMiles: number | null }>> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "invoices.issue",
  );

  const months = input.warrantyMonths ?? null;
  const miles = input.warrantyMiles ?? null;
  if (months !== null && (!Number.isSafeInteger(months) || months < 1)) {
    throw new WarrantyFailed("invalid_terms");
  }
  if (miles !== null && (!Number.isSafeInteger(miles) || miles < 1)) {
    throw new WarrantyFailed("invalid_terms");
  }

  const invoice = await input.db.invoice.findFirst({
    where: { id: input.invoiceId, organizationId: input.context.organizationId },
    select: { id: true, status: true },
  });
  if (!invoice) throw new WarrantyFailed("invoice_not_found");
  if (invoice.status !== "DRAFT") throw new WarrantyFailed("invoice_not_draft");

  await input.db.invoice.update({
    where: { id: invoice.id },
    data: {
      warrantyMonths: months,
      warrantyMiles: miles,
    },
  });
  return { warrantyMonths: months, warrantyMiles: miles };
}

export type WarrantyCoverage = Readonly<{
  invoiceId: string;
  invoiceNumber: string;
  workOrderId: string;
  workOrderNumber: string;
  customerConcern: string;
  issuedAt: Date;
  warrantyMonths: number | null;
  warrantyMiles: number | null;
  /** Null when terms are miles-only. */
  expiresAt: Date | null;
  lastKnownMileage: number | null;
}>;

function addMonths(instant: Date, months: number): Date {
  const result = new Date(instant);
  result.setUTCMonth(result.getUTCMonth() + months);
  return result;
}

/**
 * Warranty coverage still open for an asset, derived from issued invoices
 * (the document that establishes coverage). Rows with a time term appear
 * until it lapses; mileage is advisory — shops see the last known odometer
 * and judge. Coverage never grants anything by itself: it informs the
 * writer so warrantied work isn't re-charged by accident.
 */
export async function activeWarrantyForAsset(
  input: WarrantyServiceInput & { assetId: string; now?: Date },
): Promise<readonly WarrantyCoverage[]> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.read",
  );
  const now = input.now ?? new Date();

  const asset = await input.db.asset.findFirst({
    where: { id: input.assetId, organizationId: input.context.organizationId },
    select: { id: true, automotiveProfile: { select: { lastKnownMileage: true } } },
  });
  if (!asset) return [];

  const invoices = await input.db.invoice.findMany({
    where: {
      organizationId: input.context.organizationId,
      status: { in: ["ISSUED", "PARTIALLY_PAID", "PAID"] },
      issuedAt: { not: null },
      workOrder: { assetId: asset.id },
      OR: [{ warrantyMonths: { not: null } }, { warrantyMiles: { not: null } }],
    },
    orderBy: { issuedAt: "desc" },
    select: {
      id: true,
      number: true,
      issuedAt: true,
      warrantyMonths: true,
      warrantyMiles: true,
      workOrder: { select: { id: true, number: true, customerConcern: true } },
    },
  });

  return invoices
    .filter((invoice) => {
      if (!invoice.warrantyMonths) return true; // miles-only never lapses by time
      return addMonths(invoice.issuedAt!, invoice.warrantyMonths) > now;
    })
    .map((invoice) => ({
      invoiceId: invoice.id,
      invoiceNumber: invoice.number,
      workOrderId: invoice.workOrder.id,
      workOrderNumber: invoice.workOrder.number,
      customerConcern: invoice.workOrder.customerConcern,
      issuedAt: invoice.issuedAt!,
      warrantyMonths: invoice.warrantyMonths,
      warrantyMiles: invoice.warrantyMiles,
      expiresAt: invoice.warrantyMonths
        ? addMonths(invoice.issuedAt!, invoice.warrantyMonths)
        : null,
      lastKnownMileage: asset.automotiveProfile?.lastKnownMileage ?? null,
    }));
}
