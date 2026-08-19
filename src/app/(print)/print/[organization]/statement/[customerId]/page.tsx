import { notFound } from "next/navigation";

import { db } from "@/db/client";
import { PrintButton } from "@/components/print/print-button";
import { PrintFrame, PrintSection } from "@/components/print/print-frame";
import { formatDate, formatMoney } from "@/i18n/formatters";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { resolvePaperSize } from "@/modules/organizations/paper-size";
import { orgContactLine } from "@/modules/organizations/org-contact";
import { ArFailed, getCustomerStatement } from "@/modules/billing/ar-service";

export const dynamic = "force-dynamic";

/**
 * Printable customer statement: issued invoices and payments in date order
 * with a running balance, as of today. Historical issued amounts are never
 * recomputed here — the statement is a projection (ADR 0004).
 */
export default async function StatementPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ organization: string; customerId: string }>;
  searchParams: Promise<{ paper?: string }>;
}) {
  const { organization, customerId } = await params;
  const { paper: paperOverride } = await searchParams;
  const context = await getRequestContext(organization);
  if (context.organizationId !== organization) notFound();
  if (!context.permissions.has("payments.record")) notFound();

  let statement;
  try {
    statement = await getCustomerStatement({ db, context, customerId });
  } catch (error) {
    if (error instanceof ArFailed) notFound();
    throw error;
  }
  if (!statement) notFound();

  const org = await db.organization.findUnique({
    where: { id: context.organizationId },
    select: {
      name: true,
      defaultPaperSize: true,
      defaultLocale: true,
      contactPhone: true,
      contactEmail: true,
      addressLine1: true,
      city: true,
      stateProvince: true,
      postalCode: true,
      country: true,
    },
  });
  if (!org) notFound();
  const locale = org.defaultLocale ?? "en-US";

  const paper = resolvePaperSize(org.defaultPaperSize, paperOverride);

  return (
    <>
      <PrintButton paper={paper} />
      <PrintFrame
        organizationName={org.name}
        locationName="Account statement"
        title={`Statement — ${statement.customerName}`}
        subtitle={`As of ${formatDate(statement.asOf, "UTC", locale)}`}
        contactLine={orgContactLine(org)}
      >
        <PrintSection heading="Activity">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-2 font-medium">Date</th>
                <th className="py-2 font-medium">Description</th>
                <th className="py-2 text-right font-medium">Amount</th>
                <th className="py-2 text-right font-medium">Balance</th>
              </tr>
            </thead>
            <tbody>
              {statement.lines.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-4 text-center text-muted-foreground">
                    No activity on record.
                  </td>
                </tr>
              ) : (
                statement.lines.map((line, index) => (
                  <tr key={`${line.kind}-${index}`} className="border-b border-border/60">
                    <td className="py-2 tabular-nums">{formatDate(line.date, "UTC", locale)}</td>
                    <td className="py-2">
                      {line.label}
                      {line.reference ? (
                        <span className="ml-1 text-muted-foreground">({line.reference})</span>
                      ) : null}
                    </td>
                    <td
                      className={`py-2 text-right tabular-nums ${line.kind === "payment" ? "text-muted-foreground" : ""}`}
                    >
                      {line.kind === "payment" ? "−" : ""}
                      {formatMoney(
                        Number(line.amountMinor < 0n ? -line.amountMinor : line.amountMinor),
                        line.currency,
                        "en-US",
                      )}
                    </td>
                    <td className="py-2 text-right font-medium tabular-nums">
                      {formatMoney(Number(line.runningBalanceMinor), line.currency, locale)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border">
                <td colSpan={3} className="py-2 text-right font-semibold">
                  Balance due
                </td>
                <td className="py-2 text-right font-mono font-semibold tabular-nums">
                  {formatMoney(Number(statement.balanceMinor), statement.currency, locale)}
                </td>
              </tr>
            </tfoot>
          </table>
          <p className="mt-4 text-xs text-neutral-500">
            Thank you for your business. Please contact us about any line on this statement.
          </p>
        </PrintSection>
      </PrintFrame>
    </>
  );
}
