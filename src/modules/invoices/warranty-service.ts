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
    /** Per-line terms (job granularity): null clears to the invoice default. */
    lines?:
      | ReadonlyArray<
          Readonly<{
            lineId: string;
            warrantyMonths?: number | null | undefined;
            warrantyMiles?: number | null | undefined;
          }>
        >
      | undefined;
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

  for (const line of input.lines ?? []) {
    if (
      line.warrantyMonths !== undefined &&
      line.warrantyMonths !== null &&
      (!Number.isSafeInteger(line.warrantyMonths) || line.warrantyMonths < 1)
    ) {
      throw new WarrantyFailed("invalid_terms");
    }
    if (
      line.warrantyMiles !== undefined &&
      line.warrantyMiles !== null &&
      (!Number.isSafeInteger(line.warrantyMiles) || line.warrantyMiles < 1)
    ) {
      throw new WarrantyFailed("invalid_terms");
    }
  }

  await input.db.$transaction(async (transaction) => {
    const fresh = await transaction.invoice.findFirst({
      where: { id: invoice.id, organizationId: input.context.organizationId },
      select: { status: true },
    });
    if (fresh?.status !== "DRAFT") throw new WarrantyFailed("invoice_not_draft");

    await transaction.invoice.update({
      where: { id: invoice.id },
      data: {
        warrantyMonths: months,
        warrantyMiles: miles,
      },
    });
    for (const line of input.lines ?? []) {
      const owned = await transaction.invoiceLine.findFirst({
        where: {
          id: line.lineId,
          organizationId: input.context.organizationId,
          invoiceId: invoice.id,
        },
        select: { id: true },
      });
      if (!owned) throw new WarrantyFailed("invoice_not_found");
      await transaction.invoiceLine.update({
        where: { id: owned.id },
        data: {
          warrantyMonths: line.warrantyMonths ?? null,
          warrantyMiles: line.warrantyMiles ?? null,
        },
      });
    }
  });
  return { warrantyMonths: months, warrantyMiles: miles };
}

export type WarrantyCoverage = Readonly<{
  invoiceId: string;
  invoiceNumber: string;
  workOrderId: string;
  workOrderNumber: string;
  customerConcern: string;
  /** Job the terms cover; "Whole invoice" for the invoice-level fallback. */
  jobLabel: string;
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
      OR: [
        { warrantyMonths: { not: null } },
        { warrantyMiles: { not: null } },
        {
          lines: {
            some: { OR: [{ warrantyMonths: { not: null } }, { warrantyMiles: { not: null } }] },
          },
        },
      ],
    },
    orderBy: { issuedAt: "desc" },
    select: {
      id: true,
      number: true,
      issuedAt: true,
      warrantyMonths: true,
      warrantyMiles: true,
      workOrder: { select: { id: true, number: true, customerConcern: true } },
      lines: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          warrantyMonths: true,
          warrantyMiles: true,
          sourceEstimateLine: {
            select: { serviceGroupKey: true, serviceGroupLabel: true },
          },
        },
      },
    },
  });

  const coverage: WarrantyCoverage[] = [];
  const mileage = asset.automotiveProfile?.lastKnownMileage ?? null;
  for (const invoice of invoices) {
    // Group lines by job; explicit line terms cover their job, and the
    // invoice-level terms are the fallback for everything else.
    const jobsWithTerms = new Map<string, { label: string; months: number; miles: number }>();
    let anyUngroupedLine = false;
    for (const line of invoice.lines) {
      const explicit = line.warrantyMonths !== null || line.warrantyMiles !== null ? line : null;
      const group = line.sourceEstimateLine;
      const label =
        group?.serviceGroupLabel ??
        (group && group.serviceGroupKey !== "general" ? group.serviceGroupKey : null);
      if (!explicit) {
        if (!label) anyUngroupedLine = true;
        continue;
      }
      const key = group?.serviceGroupKey ?? "__line__";
      const existing = jobsWithTerms.get(key);
      const months = Math.max(existing?.months ?? 0, explicit.warrantyMonths ?? 0);
      const miles = Math.max(existing?.miles ?? 0, explicit.warrantyMiles ?? 0);
      jobsWithTerms.set(key, { label: label ?? "Line item", months, miles });
    }

    const coveredJobs = new Set(jobsWithTerms.keys());
    const hasJobWithoutTerms =
      anyUngroupedLine ||
      new Set(
        invoice.lines
          .map((line) => line.sourceEstimateLine?.serviceGroupKey ?? "__line__")
          .filter((key) => !coveredJobs.has(key)),
      ).size > 0;

    const rows: Array<{ label: string; months: number; miles: number }> = [
      ...[...jobsWithTerms.values()],
      // The invoice-level fallback covers any job without explicit terms.
      ...(invoice.warrantyMonths || invoice.warrantyMiles
        ? hasJobWithoutTerms || jobsWithTerms.size === 0
          ? [
              {
                label: "Whole invoice",
                months: invoice.warrantyMonths ?? 0,
                miles: invoice.warrantyMiles ?? 0,
              },
            ]
          : []
        : []),
    ];

    for (const row of rows) {
      if (row.months > 0) {
        const expiresAt = addMonths(invoice.issuedAt!, row.months);
        if (expiresAt <= now) continue;
        coverage.push({
          invoiceId: invoice.id,
          invoiceNumber: invoice.number,
          workOrderId: invoice.workOrder.id,
          workOrderNumber: invoice.workOrder.number,
          customerConcern: invoice.workOrder.customerConcern,
          jobLabel: row.label,
          issuedAt: invoice.issuedAt!,
          warrantyMonths: row.months,
          warrantyMiles: row.miles > 0 ? row.miles : null,
          expiresAt,
          lastKnownMileage: mileage,
        });
      } else {
        coverage.push({
          invoiceId: invoice.id,
          invoiceNumber: invoice.number,
          workOrderId: invoice.workOrder.id,
          workOrderNumber: invoice.workOrder.number,
          customerConcern: invoice.workOrder.customerConcern,
          jobLabel: row.label,
          issuedAt: invoice.issuedAt!,
          warrantyMonths: null,
          warrantyMiles: row.miles,
          expiresAt: null,
          lastKnownMileage: mileage,
        });
      }
    }
  }
  return coverage;
}
