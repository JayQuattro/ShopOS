"use client";

import { useEffect, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/i18n/formatters";

type LineState = {
  estimateLineId: string;
  description: string | null;
  totalMinor: string | null;
  decision: "APPROVED" | "DECLINED" | "PENDING";
};

const METHODS = [
  { value: "PHONE", label: "Phone (verbal)" },
  { value: "IN_PERSON", label: "In person" },
  { value: "EMAIL", label: "Email" },
  { value: "OTHER", label: "Other" },
] as const;

/**
 * Staff-side decision recorder for a PRESENTED document. Supports per-line
 * approve/decline with the customer's method and provenance (ADR 0014) —
 * including verbal approvals recorded on the customer's behalf.
 */
export function AuthorizationRecorder({
  revisionId,
  currency,
}: {
  revisionId: string;
  currency: string;
}) {
  const [lines, setLines] = useState<LineState[]>([]);
  const [choices, setChoices] = useState<Record<string, "APPROVED" | "DECLINED" | "PENDING">>({});
  const [method, setMethod] = useState<string>("PHONE");
  const [providedByName, setProvidedByName] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recorded, setRecorded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/estimate-revisions/${revisionId}/authorizations`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const state: LineState[] = (data.lines ?? []).map(
          (line: { estimateLineId: string; decision: LineState["decision"] }) => line,
        );
        setLines(state);
        setChoices(Object.fromEntries(state.map((line) => [line.estimateLineId, line.decision])));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [revisionId]);

  const undecided = lines.filter((line) => choices[line.estimateLineId] === "PENDING");
  const allDecided = lines.length > 0 && undecided.length === 0;
  const selected = undecided.filter(
    (line) =>
      choices[line.estimateLineId] !== undefined && choices[line.estimateLineId] !== "PENDING",
  );

  async function submit() {
    if (selected.length === 0 || providedByName.trim().length < 1) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/estimate-revisions/${revisionId}/authorizations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method,
          providedByName: providedByName.trim(),
          ...(note.trim() ? { note: note.trim() } : {}),
          decisions: selected.map((line) => ({
            estimateLineId: line.estimateLineId,
            decision: choices[line.estimateLineId],
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to record");
      setRecorded(true);
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not record the decision.");
    } finally {
      setPending(false);
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading decisions…</p>;
  if (allDecided && !recorded) {
    return (
      <p className="border-t border-border pt-3 text-sm text-muted-foreground">
        All lines of this document are decided.
      </p>
    );
  }
  if (lines.length === 0) return null;

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-3">
      <h4 className="text-sm font-semibold">Record the customer&rsquo;s decision</h4>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="py-2 pr-4 font-medium">Line</th>
            <th className="py-2 pr-4 font-medium text-right">Total</th>
            <th className="py-2 pr-4 font-medium">Decision</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => {
            const choice = choices[line.estimateLineId] ?? "PENDING";
            return (
              <tr key={line.estimateLineId} className="border-b border-border/60">
                <td className="py-2 pr-4">{line.description ?? "Line"}</td>
                <td className="py-2 pr-4 text-right font-mono tabular-nums">
                  {formatMoney(Number(line.totalMinor ?? 0), currency, "en-US")}
                </td>
                <td className="py-2 pr-4">
                  {choice === "PENDING" ? (
                    <div className="flex gap-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setChoices((prev) => ({
                            ...prev,
                            [line.estimateLineId]: "APPROVED",
                          }))
                        }
                      >
                        Approve
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setChoices((prev) => ({
                            ...prev,
                            [line.estimateLineId]: "DECLINED",
                          }))
                        }
                      >
                        Decline
                      </Button>
                    </div>
                  ) : (
                    <Badge variant={choice === "APPROVED" ? "default" : "secondary"}>
                      {choice}
                    </Badge>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-sm font-medium">
          Method
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            className="h-[var(--control-height)] rounded-md border border-input bg-background px-2 text-sm"
          >
            {METHODS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-medium">
          Customer name *
          <Input
            value={providedByName}
            onChange={(e) => setProvidedByName(e.target.value)}
            placeholder="Who approved/declined"
            className="max-w-[16rem]"
          />
        </label>
        <label className="grid gap-1 text-sm font-medium">
          Note
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional context"
            className="max-w-xs"
          />
        </label>
        <Button
          size="sm"
          onClick={submit}
          disabled={pending || selected.length === 0 || providedByName.trim().length < 1}
        >
          Record decision
        </Button>
      </div>
    </div>
  );
}
