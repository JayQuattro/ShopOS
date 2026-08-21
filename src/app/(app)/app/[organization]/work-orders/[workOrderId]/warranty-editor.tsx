"use client";

import { useEffect, useMemo, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type LineRow = {
  id: string;
  description: string;
  warrantyMonths: number | null;
  warrantyMiles: number | null;
  groupLabel: string | null;
};

type LinesResponse = {
  lines?: Array<{
    id: string;
    description: string;
    warrantyMonths: number | null;
    warrantyMiles: number | null;
    groupLabel: string | null;
  }>;
};

function termsLabel(months: number | null, miles: number | null): string {
  const parts: string[] = [];
  if (months) parts.push(`${months} mo`);
  if (miles) parts.push(`${Intl.NumberFormat("en-US").format(miles)} mi`);
  return parts.length > 0 ? parts.join(" or ") : "invoice default";
}

async function fetchLines(invoiceId: string): Promise<LineRow[]> {
  const res = await fetch(`/api/invoices/${invoiceId}/lines`);
  if (!res.ok) return [];
  const data = (await res.json()) as LinesResponse;
  return (data.lines ?? []).map((line) => ({
    id: line.id,
    description: line.description,
    warrantyMonths: line.warrantyMonths,
    warrantyMiles: line.warrantyMiles,
    groupLabel: line.groupLabel,
  }));
}

/**
 * Warranty terms at job granularity: each job on the invoice can carry its
 * own terms (brakes 24/24k, oil change 90 days), and the invoice-level
 * terms act as the default for everything else. Editable while DRAFT,
 * frozen at issue.
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
  const [lines, setLines] = useState<LineRow[]>([]);
  const [invoiceMonths, setInvoiceMonths] = useState(initialMonths?.toString() ?? "");
  const [invoiceMiles, setInvoiceMiles] = useState(initialMiles?.toString() ?? "");
  const [draft, setDraft] = useState<Record<string, { months: string; miles: string }>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ months: number | null; miles: number | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        const rows = await fetchLines(invoiceId);
        if (!cancelled) setLines(rows);
      })();
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [invoiceId]);

  const jobs = useMemo(() => {
    const byJob = new Map<
      string,
      { label: string; lineIds: string[]; months: number | null; miles: number | null }
    >();
    for (const line of lines) {
      const key = line.groupLabel ?? "__other__";
      if (!byJob.has(key)) {
        byJob.set(key, {
          label: line.groupLabel ?? "Other items",
          lineIds: [],
          months: null,
          miles: null,
        });
      }
      const job = byJob.get(key)!;
      job.lineIds.push(line.id);
      if (line.warrantyMonths || line.warrantyMiles) {
        job.months = Math.max(job.months ?? 0, line.warrantyMonths ?? 0) || null;
        job.miles = Math.max(job.miles ?? 0, line.warrantyMiles ?? 0) || null;
      }
    }
    return [...byJob.values()];
  }, [lines]);

  const shown = saved ?? { months: initialMonths, miles: initialMiles };

  async function save() {
    setPending(true);
    setError(null);
    try {
      const linePayload = lines.map((line) => {
        const d = draft[line.id] ?? {
          months: line.warrantyMonths?.toString() ?? "",
          miles: line.warrantyMiles?.toString() ?? "",
        };
        return {
          lineId: line.id,
          warrantyMonths: d.months.trim() ? Number(d.months) : null,
          warrantyMiles: d.miles.trim() ? Number(d.miles) : null,
        };
      });
      for (const entry of linePayload) {
        if (
          entry.warrantyMonths !== null &&
          (!Number.isInteger(entry.warrantyMonths) || entry.warrantyMonths < 1)
        ) {
          throw new Error("Months must be a whole number of 1 or more.");
        }
        if (
          entry.warrantyMiles !== null &&
          (!Number.isInteger(entry.warrantyMiles) || entry.warrantyMiles < 1)
        ) {
          throw new Error("Miles must be a whole number of 1 or more.");
        }
      }
      const res = await fetch(`/api/invoices/${invoiceId}/warranty`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          warrantyMonths: invoiceMonths.trim() ? Number(invoiceMonths) : null,
          warrantyMiles: invoiceMiles.trim() ? Number(invoiceMiles) : null,
          lines: linePayload,
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
      setDraft({});
      setLines(await fetchLines(invoiceId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the warranty terms.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-3">
      <p className="text-sm font-semibold">
        Warranty
        <span className="ml-2 font-normal text-muted-foreground">
          invoice default {termsLabel(shown.months, shown.miles)}
          {issuedAt ? " from invoice date" : ""}
        </span>
      </p>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {canEdit ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="flex flex-wrap items-end gap-2 rounded-md border border-border p-3">
            <label className="grid gap-1 text-sm font-medium">
              Whole-invoice default · months
              <Input
                type="number"
                min={1}
                placeholder="24"
                value={invoiceMonths}
                onChange={(e) => setInvoiceMonths(e.target.value)}
                disabled={pending}
                className="w-24"
              />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              miles
              <Input
                type="number"
                min={1}
                placeholder="24000"
                value={invoiceMiles}
                onChange={(e) => setInvoiceMiles(e.target.value)}
                disabled={pending}
                className="w-32"
              />
            </label>
            <span className="text-xs text-muted-foreground">
              Applies to any job without its own terms.
            </span>
          </div>

          {jobs.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {jobs.map((job) => (
                <li
                  key={job.label}
                  className="flex flex-wrap items-end justify-between gap-2 rounded-md border border-border p-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{job.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {job.months || job.miles
                        ? `Current: ${termsLabel(job.months, job.miles)}`
                        : "Uses the invoice default"}
                    </p>
                  </div>
                  <div className="flex items-end gap-1">
                    {job.lineIds.map((lineId) => {
                      const line = lines.find((l) => l.id === lineId)!;
                      const d = draft[lineId] ?? {
                        months: line.warrantyMonths?.toString() ?? "",
                        miles: line.warrantyMiles?.toString() ?? "",
                      };
                      return (
                        <div key={lineId} className="flex items-end gap-1">
                          <Input
                            type="number"
                            min={1}
                            placeholder="mo"
                            aria-label={`Months for ${line.description}`}
                            value={d.months}
                            onChange={(e) =>
                              setDraft((prev) => ({
                                ...prev,
                                [lineId]: { ...d, months: e.target.value },
                              }))
                            }
                            disabled={pending}
                            className="w-20"
                          />
                          <Input
                            type="number"
                            min={1}
                            placeholder="mi"
                            aria-label={`Miles for ${line.description}`}
                            value={d.miles}
                            onChange={(e) =>
                              setDraft((prev) => ({
                                ...prev,
                                [lineId]: { ...d, miles: e.target.value },
                              }))
                            }
                            disabled={pending}
                            className="w-24"
                          />
                        </div>
                      );
                    })}
                  </div>
                </li>
              ))}
            </ul>
          ) : null}

          <div>
            <Button type="submit" size="sm" disabled={pending}>
              Save warranty
            </Button>
          </div>
        </form>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {jobs
            .filter((job) => job.months || job.miles)
            .map((job) => (
              <li key={job.label}>
                <span className="font-medium">{job.label}:</span>{" "}
                <span className="text-muted-foreground">{termsLabel(job.months, job.miles)}</span>
              </li>
            ))}
          <li className="text-muted-foreground">
            Everything else: {termsLabel(shown.months, shown.miles)}
          </li>
        </ul>
      )}
    </div>
  );
}
