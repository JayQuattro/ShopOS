import Link from "next/link";

import { formatMoney } from "@/i18n/formatters";

export type WorkOrderContextBarProps = Readonly<{
  organizationId: string;
  customerId: string;
  customerName: string;
  vehicleName: string | null;
  locationName: string | null;
  estimateMinor: bigint | null;
  authorizedMinor: bigint;
  invoiceMinor: bigint | null;
  paidMinor: bigint | null;
  currency: string;
}>;

/**
 * The always-visible strip above the work order tabs: who and what vehicle,
 * plus the money snapshot — estimate, authorized, balance — so no tab switch
 * ever hides the numbers that matter (AGENTS.md: never hide totals or
 * authorization state).
 */
export function WorkOrderContextBar({
  organizationId,
  customerId,
  customerName,
  vehicleName,
  locationName,
  estimateMinor,
  authorizedMinor,
  invoiceMinor,
  paidMinor,
  currency,
}: WorkOrderContextBarProps) {
  const money = (minor: bigint | null) =>
    minor === null ? "—" : formatMoney(Number(minor), currency, "en-US");
  const balanceMinor =
    invoiceMinor !== null && paidMinor !== null ? invoiceMinor - paidMinor : null;

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <Link
          href={`/app/${organizationId}/customers/${customerId}`}
          className="font-medium text-link underline-offset-4 hover:underline"
        >
          {customerName}
        </Link>
        <span className="text-muted-foreground">·</span>
        {vehicleName ? <span className="font-medium">{vehicleName}</span> : <span>No vehicle</span>}
        {locationName ? (
          <>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">{locationName}</span>
          </>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
        <span>
          <span className="text-xs text-muted-foreground">Estimate </span>
          <span className="font-mono font-semibold tabular-nums">{money(estimateMinor)}</span>
        </span>
        <span>
          <span className="text-xs text-muted-foreground">Authorized </span>
          <span className="font-mono font-semibold tabular-nums">{money(authorizedMinor)}</span>
        </span>
        <span>
          <span className="text-xs text-muted-foreground">Balance </span>
          <span className="font-mono font-semibold tabular-nums">
            {invoiceMinor === null ? "not invoiced" : money(balanceMinor)}
          </span>
        </span>
      </div>
    </div>
  );
}
