"use client";

import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

type Status =
  | "DRAFT"
  | "ESTIMATING"
  | "AWAITING_AUTHORIZATION"
  | "AUTHORIZED"
  | "IN_PROGRESS"
  | "BLOCKED"
  | "COMPLETED"
  | "INVOICED"
  | "CLOSED"
  | "CANCELLED";

const STATUS_LABELS: Record<Status, string> = {
  DRAFT: "Draft",
  ESTIMATING: "Estimating",
  AWAITING_AUTHORIZATION: "Awaiting authorization",
  AUTHORIZED: "Authorized",
  IN_PROGRESS: "In progress",
  BLOCKED: "Blocked",
  COMPLETED: "Completed",
  INVOICED: "Invoiced",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
};

/** Valid transitions per the state machine (DRAFT → … → CLOSED). */
const TRANSITIONS: Record<Status, Status[]> = {
  DRAFT: ["ESTIMATING", "CANCELLED"],
  ESTIMATING: ["AWAITING_AUTHORIZATION", "DRAFT", "CANCELLED"],
  AWAITING_AUTHORIZATION: ["AUTHORIZED", "ESTIMATING", "CANCELLED"],
  AUTHORIZED: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["BLOCKED", "COMPLETED", "CANCELLED"],
  BLOCKED: ["IN_PROGRESS", "CANCELLED"],
  COMPLETED: ["INVOICED", "CANCELLED"],
  INVOICED: ["CLOSED"],
  CLOSED: [],
  CANCELLED: [],
};

export function StatusTransitionPanel({
  workOrderId,
  currentStatus,
  canWrite,
}: {
  workOrderId: string;
  currentStatus: string;
  canWrite: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const status = currentStatus as Status;
  const available = TRANSITIONS[status] ?? [];
  const isTerminal = available.length === 0;

  async function transition(target: Status) {
    if (target === "CANCELLED" && !confirm("Cancel this work order? This cannot be undone.")) {
      return;
    }
    setPending(true);
    setError(null);
    setErrorKey(null);
    try {
      const res = await fetch(`/api/work-orders/${workOrderId}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: target }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErrorKey(body.error ?? "failed");
        setError(body.message ?? `Could not transition to ${STATUS_LABELS[target]}.`);
        return;
      }
      window.location.reload();
    } catch {
      setError("Something went wrong.");
    } finally {
      setPending(false);
    }
  }

  if (!canWrite || isTerminal) return null;

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <Alert
          variant={
            errorKey === "estimate_required" || errorKey === "authorization_required"
              ? "warning"
              : "destructive"
          }
        >
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {available.map((target) => (
          <Button
            key={target}
            size="sm"
            variant={
              target === "CANCELLED" ? "destructive" : target === "BLOCKED" ? "outline" : "default"
            }
            onClick={() => transition(target)}
            disabled={pending}
          >
            → {STATUS_LABELS[target]}
          </Button>
        ))}
      </div>
    </div>
  );
}
