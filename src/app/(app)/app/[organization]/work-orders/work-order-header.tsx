"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";

import { formatMoney } from "@/i18n/formatters";
import { cn } from "@/lib/utils";

export type WorkOrderHeaderProps = Readonly<{
  number: string;
  organizationId: string;
  statusBadge: ReactNode;
  /** Recommended next action rendered in the collapsed strip. */
  nextStep?: ReactNode;
  customerId: string;
  customerName: string;
  vehicleName: string | null;
  locationName: string | null;
  estimateMinor: bigint | null;
  authorizedMinor: bigint;
  invoiceMinor: bigint | null;
  paidMinor: bigint | null;
  currency: string;
  /** Management controls revealed on expand (assignment, vehicle, stage, status, print). */
  children: ReactNode;
}>;

/**
 * Collapsible work-order header. Collapsed — one compact strip carrying the
 * essentials that must never be hidden: RO number, status, customer · vehicle ·
 * location, and the money snapshot (estimate / authorized / balance). Expanded —
 * the management controls (technician, vehicle and stage, key, status actions,
 * print). Setup chrome lives in here instead of pushing the actual work down
 * the first tab.
 */
export function WorkOrderHeader({
  number,
  organizationId,
  statusBadge,
  nextStep,
  customerId,
  customerName,
  vehicleName,
  locationName,
  estimateMinor,
  authorizedMinor,
  invoiceMinor,
  paidMinor,
  currency,
  children,
}: WorkOrderHeaderProps) {
  const [open, setOpen] = useState(false);

  const money = (minor: bigint | null) =>
    minor === null ? "—" : formatMoney(Number(minor), currency, "en-US");
  const balanceMinor =
    invoiceMinor !== null && paidMinor !== null ? invoiceMinor - paidMinor : null;

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5">
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          aria-label={open ? "Hide work order details" : "Show work order details"}
          className="flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ChevronDown
            className={cn("size-4 transition-transform", open && "rotate-180")}
            aria-hidden
          />
        </button>
        <span className="font-mono text-sm font-semibold">{number}</span>
        {statusBadge}
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <Link
            href={`/app/${organizationId}/customers/${customerId}`}
            className="font-medium text-link underline-offset-4 hover:underline"
          >
            {customerName}
          </Link>
          <span className="text-muted-foreground">·</span>
          {vehicleName ? (
            <span className="font-medium">{vehicleName}</span>
          ) : (
            <span>No vehicle</span>
          )}
          {locationName ? (
            <>
              <span className="text-muted-foreground">·</span>
              <span className="text-muted-foreground">{locationName}</span>
            </>
          ) : null}
        </div>
        {nextStep ? <span className="ml-auto">{nextStep}</span> : null}
        <div
          className={
            "flex flex-wrap items-center gap-x-5 gap-y-1 text-sm" +
            (nextStep ? " ml-0" : " ml-auto")
          }
        >
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

      {open ? (
        <div className="border-t border-border p-4">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{children}</div>
        </div>
      ) : null}
    </div>
  );
}
