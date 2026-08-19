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
  previousDocuments: ReadonlyArray<{
    label: string;
    approvedLines: ReadonlyArray<{ description: string; amountMinor: string }>;
    declinedCount: number;
  }>;
  linePhotos: Record<string, Array<{ id: string; fileName: string }>>;
  lines: ReadonlyArray<{
    id: string;
    description: string;
    totalMinor: string;
    authorizationRequired: boolean;
  }>;
  attachments: ReadonlyArray<{
    id: string;
    fileName: string;
    contentType: string;
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

        {data.attachments.length > 0 ? (
          <div className="mt-6">
            <h2 className="text-sm font-semibold">Photos from the shop</h2>
            <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {data.attachments.map((attachment) => (
                <a
                  key={attachment.id}
                  href={`/api/public/authorize/${token}/attachments/${attachment.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="group block overflow-hidden rounded-lg border border-border bg-muted"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- remote evidence served through the token-scoped route */}
                  <img
                    src={`/api/public/authorize/${token}/attachments/${attachment.id}`}
                    alt={attachment.fileName}
                    className="aspect-square w-full object-cover transition-opacity group-hover:opacity-90"
                    loading="lazy"
                  />
                </a>
              ))}
            </div>
          </div>
        ) : null}

        <div className="mt-6 rounded-lg border border-border bg-card p-4 shadow-sm">
          {isChangeOrder && data.previousDocuments.length > 0 ? (
            <details className="mb-3 rounded-md border border-border bg-muted/40 px-3 py-2">
              <summary className="cursor-pointer text-sm font-medium">
                What you&rsquo;ve already approved on this job
              </summary>
              <div className="mt-2 flex flex-col gap-2">
                {data.previousDocuments.map((doc) => (
                  <div key={doc.label}>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {doc.label}
                      {doc.declinedCount > 0
                        ? ` · ${doc.declinedCount} item${doc.declinedCount === 1 ? "" : "s"} declined`
                        : ""}
                    </p>
                    <ul className="mt-1 flex flex-col gap-0.5">
                      {doc.approvedLines.map((line, index) => (
                        <li key={index} className="flex justify-between gap-4 text-sm">
                          <span>{line.description}</span>
                          <span className="font-mono tabular-nums">
                            {formatMoney(Number(line.amountMinor), data.currency, "en-US")}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </details>
          ) : null}
          {isChangeOrder ? (
            <p className="mb-3 text-sm text-muted-foreground">
              You&rsquo;re only deciding the items below — everything above stays approved exactly
              as it is.
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
                  <td className="py-3 pr-4">
                    {line.description}
                    {(data.linePhotos?.[line.id] ?? []).length > 0 ? (
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {(data.linePhotos[line.id] ?? []).map((photo) => (
                          <a
                            key={photo.id}
                            href={`/api/public/authorize/${token}/attachments/${photo.id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="block overflow-hidden rounded-md border border-border"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element -- token-scoped evidence */}
                            <img
                              src={`/api/public/authorize/${token}/attachments/${photo.id}`}
                              alt={line.description}
                              className="h-16 w-20 object-cover"
                              loading="lazy"
                            />
                          </a>
                        ))}
                      </div>
                    ) : null}
                  </td>
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
