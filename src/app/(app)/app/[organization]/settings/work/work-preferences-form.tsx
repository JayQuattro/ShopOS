"use client";

import { useEffect, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type WorkPreferences = {
  changeOrderCreditPolicy: "AUTO_APPLY" | "REQUIRE_APPROVAL";
  invoiceLinePolicy: "APPROVED_ONLY" | "ALL_LINES";
  taxDisplayMode: "EXCLUSIVE" | "INCLUSIVE";
  defaultPaperSize: "LETTER" | "A4" | "LEGAL";
  qualityCheckRequired: boolean;
  authorizationLinkTtlHours: number;
  workOrderNumberPrefix: string;
  invoiceNumberPrefix: string;
  defaultLaborRateMinor: number;
  defaultTaxRateBasisPoints: number;
  reviewUrl: string | null;
};

const CREDIT_POLICY_HELP: Record<WorkPreferences["changeOrderCreditPolicy"], string> = {
  AUTO_APPLY:
    "Change orders that only reduce the price are applied automatically and the customer is notified.",
  REQUIRE_APPROVAL: "Every change order — including price reductions — needs customer approval.",
};

const INVOICE_POLICY_HELP: Record<WorkPreferences["invoiceLinePolicy"], string> = {
  APPROVED_ONLY: "Invoices bill only the lines the customer approved (recommended).",
  ALL_LINES: "Invoices bill every line of the estimate documents, decided or not (legacy).",
};

const PAPER_HELP: Record<WorkPreferences["defaultPaperSize"], string> = {
  LETTER: "8.5 × 11 in — the default in North America.",
  A4: "210 × 297 mm — the international standard.",
  LEGAL: "8.5 × 14 in — for long documents and contracts.",
};

export function WorkPreferencesForm() {
  const [preferences, setPreferences] = useState<WorkPreferences | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const orgId = window.location.pathname.split("/")[2] ?? "";
        const res = await fetch(`/api/organizations/${orgId}/settings/work`);
        if (res.ok) {
          setPreferences((await res.json()) as WorkPreferences);
        } else {
          const data = await res.json().catch(() => ({}));
          setError(
            data.error === "organization_denied"
              ? "Switch into this organization first."
              : (data.error ?? "Could not load preferences."),
          );
        }
      } catch {
        setError("Could not load preferences.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!preferences) return;
    setPending(true);
    setError(null);
    setSuccess(null);
    try {
      const orgId = window.location.pathname.split("/")[2] ?? "";
      const res = await fetch(`/api/organizations/${orgId}/settings/work`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(preferences),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to save");
      }
      setSuccess("Work preferences saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setPending(false);
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!preferences) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error ?? "Preferences unavailable."}</AlertDescription>
      </Alert>
    );
  }

  return (
    <form onSubmit={save} className="grid gap-6">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {success ? (
        <Alert variant="info">
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Price-reduction change orders</CardTitle>
          <CardDescription>
            What happens when discovered work only lowers the total.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {(["AUTO_APPLY", "REQUIRE_APPROVAL"] as const).map((value) => (
            <label key={value} className="flex items-start gap-3 text-sm">
              <input
                type="radio"
                name="changeOrderCreditPolicy"
                checked={preferences.changeOrderCreditPolicy === value}
                onChange={() =>
                  setPreferences((prev) =>
                    prev ? { ...prev, changeOrderCreditPolicy: value } : prev,
                  )
                }
                disabled={pending}
                className="mt-0.5 size-4"
              />
              <span>
                <span className="font-medium">
                  {value === "AUTO_APPLY"
                    ? "Apply automatically, notify the customer"
                    : "Require customer approval"}
                </span>
                <span className="block text-muted-foreground">{CREDIT_POLICY_HELP[value]}</span>
              </span>
            </label>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tax display</CardTitle>
          <CardDescription>
            How entered prices relate to tax. Applies to new estimates.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {(["EXCLUSIVE", "INCLUSIVE"] as const).map((value) => (
            <label key={value} className="flex items-start gap-3 text-sm">
              <input
                type="radio"
                name="taxDisplayMode"
                checked={preferences.taxDisplayMode === value}
                onChange={() =>
                  setPreferences((prev) => (prev ? { ...prev, taxDisplayMode: value } : prev))
                }
                disabled={pending}
                className="mt-0.5 size-4"
              />
              <span>
                <span className="font-medium">
                  {value === "EXCLUSIVE" ? "Add tax on top (US-style)" : "Prices include tax (VAT)"}
                </span>
                <span className="block text-muted-foreground">
                  {value === "EXCLUSIVE"
                    ? "A $100 line at 8% tax charges the customer $108.00."
                    : "A €100 line at 20% VAT charges the customer €100.00 — the VAT portion (€16.67) is reported separately and already inside the price."}
                </span>
              </span>
            </label>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Invoice lines</CardTitle>
          <CardDescription>Which estimate lines end up on the invoice.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {(["APPROVED_ONLY", "ALL_LINES"] as const).map((value) => (
            <label key={value} className="flex items-start gap-3 text-sm">
              <input
                type="radio"
                name="invoiceLinePolicy"
                checked={preferences.invoiceLinePolicy === value}
                onChange={() =>
                  setPreferences((prev) => (prev ? { ...prev, invoiceLinePolicy: value } : prev))
                }
                disabled={pending}
                className="mt-0.5 size-4"
              />
              <span>
                <span className="font-medium">
                  {value === "APPROVED_ONLY" ? "Approved lines only" : "All lines"}
                </span>
                <span className="block text-muted-foreground">{INVOICE_POLICY_HELP[value]}</span>
              </span>
            </label>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Paper size</CardTitle>
          <CardDescription>Default paper for printed documents.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {(["LETTER", "A4", "LEGAL"] as const).map((value) => (
            <label key={value} className="flex items-start gap-3 text-sm">
              <input
                type="radio"
                name="defaultPaperSize"
                checked={preferences.defaultPaperSize === value}
                onChange={() =>
                  setPreferences((prev) => (prev ? { ...prev, defaultPaperSize: value } : prev))
                }
                disabled={pending}
                className="mt-0.5 size-4"
              />
              <span>
                <span className="font-medium">
                  {value === "LETTER" ? "Letter" : value === "A4" ? "A4" : "Legal"}
                </span>
                <span className="block text-muted-foreground">{PAPER_HELP[value]}</span>
              </span>
            </label>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Quality control</CardTitle>
          <CardDescription>Gate completion on a passed final check.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={preferences.qualityCheckRequired}
              onChange={(e) =>
                setPreferences((prev) =>
                  prev ? { ...prev, qualityCheckRequired: e.target.checked } : prev,
                )
              }
              disabled={pending}
              className="mt-0.5 size-4"
            />
            <span>
              <span className="font-medium">Require a passed quality check before completion</span>
              <span className="block text-muted-foreground">
                When off, jobs can complete without the QC gate.
              </span>
            </span>
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Approvals &amp; numbering</CardTitle>
          <CardDescription>
            How long approval links live, and the prefixes on new document numbers.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm font-medium">
            Approval link lifetime (hours, 1–720)
            <Input
              type="number"
              min={1}
              max={720}
              value={preferences.authorizationLinkTtlHours}
              onChange={(e) =>
                setPreferences((prev) =>
                  prev
                    ? { ...prev, authorizationLinkTtlHours: Number(e.target.value) || 72 }
                    : prev,
                )
              }
              disabled={pending}
            />
          </label>
          <label className="grid gap-1 text-sm font-medium">
            Work-order number prefix
            <Input
              value={preferences.workOrderNumberPrefix}
              onChange={(e) =>
                setPreferences((prev) =>
                  prev ? { ...prev, workOrderNumberPrefix: e.target.value } : prev,
                )
              }
              disabled={pending}
              maxLength={12}
            />
          </label>
          <label className="grid gap-1 text-sm font-medium">
            Invoice number prefix
            <Input
              value={preferences.invoiceNumberPrefix}
              onChange={(e) =>
                setPreferences((prev) =>
                  prev ? { ...prev, invoiceNumberPrefix: e.target.value } : prev,
                )
              }
              disabled={pending}
              maxLength={12}
            />
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Rates</CardTitle>
          <CardDescription>
            Shop defaults applied when template lines carry no explicit pricing.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm font-medium">
            Labor rate (per hour)
            <Input
              type="number"
              min={0}
              step="0.01"
              value={(preferences.defaultLaborRateMinor / 100).toFixed(2)}
              onChange={(e) =>
                setPreferences((prev) =>
                  prev
                    ? {
                        ...prev,
                        defaultLaborRateMinor: Math.round((Number(e.target.value) || 0) * 100),
                      }
                    : prev,
                )
              }
              disabled={pending}
            />
          </label>
          <label className="grid gap-1 text-sm font-medium">
            Tax rate (%)
            <Input
              type="number"
              min={0}
              max={100}
              step="0.1"
              value={(preferences.defaultTaxRateBasisPoints / 100).toFixed(1)}
              onChange={(e) =>
                setPreferences((prev) =>
                  prev
                    ? {
                        ...prev,
                        defaultTaxRateBasisPoints: Math.round((Number(e.target.value) || 0) * 100),
                      }
                    : prev,
                )
              }
              disabled={pending}
            />
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Review link</CardTitle>
          <CardDescription>
            Your Google / Yelp review page, linked in the thank-you text when a job closes. Leave
            empty to link the service summary instead.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <label className="grid gap-1 text-sm font-medium">
            Review page URL
            <Input
              type="url"
              value={preferences.reviewUrl ?? ""}
              onChange={(e) =>
                setPreferences((prev) => (prev ? { ...prev, reviewUrl: e.target.value } : prev))
              }
              placeholder="https://g.page/your-shop"
              disabled={pending}
            />
          </label>
        </CardContent>
      </Card>

      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save preferences"}
        </Button>
      </div>
    </form>
  );
}
