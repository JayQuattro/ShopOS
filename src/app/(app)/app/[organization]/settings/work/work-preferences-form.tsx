"use client";

import { useEffect, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type WorkPreferences = {
  changeOrderCreditPolicy: "AUTO_APPLY" | "REQUIRE_APPROVAL";
  invoiceLinePolicy: "APPROVED_ONLY" | "ALL_LINES";
  defaultPaperSize: "LETTER" | "A4" | "LEGAL";
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

      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save preferences"}
        </Button>
      </div>
    </form>
  );
}
