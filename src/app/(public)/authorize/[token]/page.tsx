"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/i18n/formatters";

type EstimateData = {
  workOrderNumber: string;
  organizationName: string;
  customerName: string;
  revisionNumber: number;
  documentKind: "BASELINE" | "CHANGE_ORDER";
  changeOrderNumber: number | null;
  summaryNote: string | null;
  currency: string;
  totalMinor: string;
  previouslyApprovedMinor: string;
  lines: ReadonlyArray<{
    id: string;
    description: string;
    totalMinor: string;
    authorizationRequired: boolean;
  }>;
};

type Decision = "APPROVED" | "DECLINED" | "PENDING";

export default function AuthorizePage() {
  const params = useParams<{ token: string }>();
  const token = params.token;

  const [data, setData] = useState<EstimateData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [summary, setSummary] = useState<{ approved: string[]; declined: string[] } | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/public/authorize/${token}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(body.error ?? "This link is invalid or has expired.");
          return;
        }
        const estimateData: EstimateData = await res.json();
        setData(estimateData);
        const initial: Record<string, Decision> = {};
        for (const line of estimateData.lines) {
          initial[line.id] = "PENDING";
        }
        setDecisions(initial);
      } catch {
        setError("Could not load this authorization link.");
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!data || !name.trim()) return;

    const decisionList = data.lines
      .filter((l) => decisions[l.id] !== "PENDING")
      .map((l) => ({
        estimateLineId: l.id,
        decision: decisions[l.id] as "APPROVED" | "DECLINED",
      }));

    if (decisionList.length === 0) return;

    setSubmitting(true);
    try {
      const res = await fetch(`/api/public/authorize/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decisions: decisionList,
          providedByName: name,
          ...(note ? { note } : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Could not submit your decision.");
        return;
      }
      setSummary({
        approved: data.lines
          .filter((l) => decisions[l.id] === "APPROVED")
          .map((l) => l.description),
        declined: data.lines
          .filter((l) => decisions[l.id] === "DECLINED")
          .map((l) => l.description),
      });
      setSubmitted(true);
    } catch {
      setError("Could not submit your decision.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Loading authorization…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background px-4">
        <div className="w-full max-w-md">
          <Alert variant="destructive">
            <AlertTitle>Authorization unavailable</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  if (submitted && data) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background px-4">
        <div className="w-full max-w-md">
          <Alert variant="info">
            <AlertTitle>Thank you</AlertTitle>
            <AlertDescription>
              <p>Your decision has been recorded for work order {data.workOrderNumber}.</p>
              {summary && summary.approved.length > 0 ? (
                <p className="mt-2">
                  <span className="font-medium">Approved:</span> {summary.approved.join(", ")}
                </p>
              ) : null}
              {summary && summary.declined.length > 0 ? (
                <p className="mt-1">
                  <span className="font-medium">Declined:</span> {summary.declined.join(", ")}
                </p>
              ) : null}
              <p className="mt-2">You can close this page.</p>
            </AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const isChangeOrder = data.documentKind === "CHANGE_ORDER";
  const previouslyApproved = Number(data.previouslyApprovedMinor);

  // Live cumulative math: what this submission approves, and the new total.
  const approvingNow = data.lines
    .filter((l) => decisions[l.id] === "APPROVED")
    .reduce((sum, l) => sum + Number(l.totalMinor), 0);
  const newTotal = previouslyApproved + approvingNow;

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-background px-4 py-10">
      <div className="w-full max-w-lg">
        <h1 className="text-xl font-semibold tracking-tight">
          {isChangeOrder ? "Approve additional work" : "Authorize work"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {data.organizationName} · Work order {data.workOrderNumber}
          {isChangeOrder
            ? ` · Change order ${data.changeOrderNumber ?? ""}`
            : ` · Revision ${data.revisionNumber}`}
        </p>
        {isChangeOrder && data.summaryNote ? (
          <p className="mt-3 rounded-md bg-muted px-3 py-2 text-sm">{data.summaryNote}</p>
        ) : null}
        {!isChangeOrder ? (
          <p className="mt-1 text-sm text-muted-foreground">For {data.customerName}</p>
        ) : null}

        <div className="mt-6 rounded-lg border border-border bg-card p-4 shadow-sm">
          {isChangeOrder ? (
            <p className="mb-3 text-sm text-muted-foreground">
              You&rsquo;ve already approved other work on this job. You&rsquo;re only deciding the
              items below.
            </p>
          ) : null}
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="pb-2 font-medium">Service</th>
                <th className="pb-2 text-right font-medium">Amount</th>
                <th className="pb-2 text-right font-medium">Your decision</th>
              </tr>
            </thead>
            <tbody>
              {data.lines.map((line) => (
                <tr key={line.id} className="border-b border-border/60">
                  <td className="py-3 pr-4">{line.description}</td>
                  <td className="py-3 pr-4 text-right font-mono tabular-nums">
                    {formatMoney(Number(line.totalMinor), data.currency, "en-US")}
                  </td>
                  <td className="py-3">
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => setDecisions((prev) => ({ ...prev, [line.id]: "APPROVED" }))}
                        className={`rounded-md px-2 py-1 text-xs font-medium ${
                          decisions[line.id] === "APPROVED"
                            ? "bg-success/20 text-success"
                            : "border border-border text-muted-foreground hover:bg-muted"
                        }`}
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => setDecisions((prev) => ({ ...prev, [line.id]: "DECLINED" }))}
                        className={`rounded-md px-2 py-1 text-xs font-medium ${
                          decisions[line.id] === "DECLINED"
                            ? "bg-destructive/20 text-destructive"
                            : "border border-border text-muted-foreground hover:bg-muted"
                        }`}
                      >
                        Decline
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              {isChangeOrder ? (
                <>
                  <tr>
                    <td className="pt-3 text-muted-foreground">Previously approved</td>
                    <td className="pt-3 text-right font-mono tabular-nums text-muted-foreground">
                      {formatMoney(previouslyApproved, data.currency, "en-US")}
                    </td>
                    <td></td>
                  </tr>
                  <tr>
                    <td className="pt-1 text-muted-foreground">This change (as selected)</td>
                    <td className="pt-1 text-right font-mono tabular-nums">
                      {formatMoney(approvingNow, data.currency, "en-US")}
                    </td>
                    <td></td>
                  </tr>
                </>
              ) : null}
              <tr className="border-t border-border">
                <td className="pt-3 font-semibold">
                  {isChangeOrder ? "New authorized total" : "Total"}
                </td>
                <td className="pt-3 text-right font-mono font-semibold tabular-nums">
                  {formatMoney(
                    isChangeOrder ? newTotal : Number(data.totalMinor),
                    data.currency,
                    "en-US",
                  )}
                </td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 grid gap-4">
          <Input
            placeholder="Your name *"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={submitting}
          />
          <Input
            placeholder="Note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={submitting}
          />
          <Button type="submit" disabled={submitting || !name.trim()}>
            {submitting ? "Submitting…" : "Submit decision"}
          </Button>
          <p className="text-xs text-muted-foreground">
            By submitting, you authorize the approved services listed above. Declined services will
            not be performed
            {isChangeOrder ? "; everything you approved previously is unaffected." : "."}
          </p>
        </form>
      </div>
    </div>
  );
}
