"use client";

import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function termsLabel(months: number | null, miles: number | null): string {
  const parts: string[] = [];
  if (months) parts.push(`${months} month${months === 1 ? "" : "s"}`);
  if (miles)
    parts.push(`${Intl.NumberFormat("en-US").format(miles)} mile${miles === 1 ? "" : "s"}`);
  return parts.length > 0 ? parts.join(" or ") : "None";
}

/**
 * Warranty terms on one invoice. Defaults come from the organization's
 * best-practice settings; the writer can adjust or clear them until the
 * invoice is issued, then they freeze with the document.
 */
export function WarrantyEditor({
  invoiceId,
  canEdit,
  initialMonths,
  initialMiles,
  issuedAt,
}: {
  invoiceId: string;
  canEdit: boolean;
  initialMonths: number | null;
  initialMiles: number | null;
  issuedAt: string | null;
}) {
  const [months, setMonths] = useState(initialMonths?.toString() ?? "");
  const [miles, setMiles] = useState(initialMiles?.toString() ?? "");
  const [saved, setSaved] = useState<{ months: number | null; miles: number | null } | null>(null);
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shown = saved ?? { months: initialMonths, miles: initialMiles };

  async function save(clear = false) {
    setPending(true);
    setError(null);
    try {
      const monthsValue = clear ? null : months.trim() ? Number(months) : null;
      const milesValue = clear ? null : miles.trim() ? Number(miles) : null;
      if (monthsValue !== null && (!Number.isInteger(monthsValue) || monthsValue < 1)) {
        throw new Error("Months must be a whole number of 1 or more.");
      }
      if (milesValue !== null && (!Number.isInteger(milesValue) || milesValue < 1)) {
        throw new Error("Miles must be a whole number of 1 or more.");
      }
      const res = await fetch(`/api/invoices/${invoiceId}/warranty`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          warrantyMonths: monthsValue,
          warrantyMiles: milesValue,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data.error === "invoice_not_draft"
            ? "The invoice is issued — warranty terms are frozen."
            : "Could not save the warranty terms.",
        );
      }
      setSaved(data);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the warranty terms.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">
          Warranty
          <span className="ml-2 font-normal text-muted-foreground">
            {termsLabel(shown.months, shown.miles)}
            {issuedAt ? " from invoice date" : ""}
          </span>
        </p>
        {canEdit && !editing ? (
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)} disabled={pending}>
            {shown.months || shown.miles ? "Change" : "Add terms"}
          </Button>
        ) : null}
      </div>
      {editing ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label className="grid gap-1 text-sm font-medium">
            Months
            <Input
              type="number"
              min={1}
              placeholder="24"
              value={months}
              onChange={(e) => setMonths(e.target.value)}
              disabled={pending}
              className="w-24"
            />
          </label>
          <label className="grid gap-1 text-sm font-medium">
            Miles
            <Input
              type="number"
              min={1}
              placeholder="24000"
              value={miles}
              onChange={(e) => setMiles(e.target.value)}
              disabled={pending}
              className="w-32"
            />
          </label>
          <Button type="submit" size="sm" disabled={pending}>
            Save
          </Button>
          {shown.months || shown.miles ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => void save(true)}
            >
              Clear
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => setEditing(false)}
          >
            Cancel
          </Button>
        </form>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
