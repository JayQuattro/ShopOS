"use client";

import { useEffect, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/i18n/formatters";

type QcState = {
  status: "pending" | "passed" | "failed";
  note: string | null;
  passedByDisplayName: string | null;
  passedAt: string | null;
  required: boolean;
  openTaskCount: number;
};

/**
 * Final quality control: pass or fail the check that gates completion.
 * Failing prompts for a reason that goes to the activity feed.
 */
export function QualityCheckCard({
  workOrderId,
  timeZone,
  canWrite,
}: {
  workOrderId: string;
  timeZone: string;
  canWrite: boolean;
}) {
  const [state, setState] = useState<QcState | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await fetch(`/api/work-orders/${workOrderId}/quality-check`);
    if (res.ok) setState((await res.json()) as QcState);
  }

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(`/api/work-orders/${workOrderId}/quality-check`);
          if (res.ok && !cancelled) setState((await res.json()) as QcState);
        } finally {
          if (!cancelled) {
            /* state stays null on failure; card renders nothing */
          }
        }
      })();
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [workOrderId]);

  async function act(action: "pass" | "fail") {
    let note: string | undefined;
    if (action === "fail") {
      const reason = window.prompt("What failed the quality check?");
      if (!reason || reason.trim().length < 3) return;
      note = reason.trim();
    } else {
      const optional = window.prompt("Note (optional)");
      if (optional === null) return;
      if (optional.trim()) note = optional.trim();
    }
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/work-orders/${workOrderId}/quality-check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...(note ? { note } : {}) }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const messages: Record<string, string> = {
          open_tasks: `Resolve the ${state?.openTaskCount ?? ""}open or flagged checklist items first.`,
          already_passed: "The quality check has already passed.",
        };
        throw new Error(messages[data.error] ?? "Action failed.");
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed.");
    } finally {
      setPending(false);
    }
  }

  if (state === null) return null;
  if (!state.required && state.status === "pending") return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">
          Quality check
          <Badge
            variant={
              state.status === "passed"
                ? "default"
                : state.status === "failed"
                  ? "destructive"
                  : "secondary"
            }
            className="ml-2"
          >
            {state.status}
          </Badge>
        </CardTitle>
        {canWrite && state.status !== "passed" ? (
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void act("pass")} disabled={pending}>
              Pass
            </Button>
            <Button size="sm" variant="outline" onClick={() => void act("fail")} disabled={pending}>
              Fail
            </Button>
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {state.status === "passed" && state.passedAt ? (
          <p className="text-sm text-muted-foreground">
            Passed by {state.passedByDisplayName ?? "unknown"} ·{" "}
            {formatDateTime(new Date(state.passedAt), timeZone, "en-US")}
            {state.note ? ` — ${state.note}` : ""}
          </p>
        ) : state.status === "failed" && state.note ? (
          <p className="text-sm text-destructive">{state.note}</p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {state.required
              ? "Completion requires a passed quality check."
              : "Quality checks are optional for this organization."}
            {state.openTaskCount > 0
              ? ` ${state.openTaskCount} checklist item${state.openTaskCount === 1 ? "" : "s"} still open or flagged.`
              : ""}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
