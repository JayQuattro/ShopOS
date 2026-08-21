"use client";

import { useState } from "react";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { WorkOrderStatus } from "@/modules/work-orders/work-order-state-machine";

/**
 * The single recommended next action for the work order's status, rendered
 * in the collapsed header: AUTHORIZED → start work, IN_PROGRESS → complete,
 * BLOCKED → resume. Statuses whose next step is document work (estimating,
 * awaiting authorization) or money (invoicing) show nothing here — their
 * workflows live in the tabs.
 */
const NEXT_STEP: Readonly<
  Partial<Record<WorkOrderStatus, { label: string; target: WorkOrderStatus }>>
> = {
  AUTHORIZED: { label: "Start work", target: "IN_PROGRESS" },
  IN_PROGRESS: { label: "Mark complete", target: "COMPLETED" },
  BLOCKED: { label: "Resume work", target: "IN_PROGRESS" },
};

export function NextStepButton({
  workOrderId,
  status,
  canWrite,
}: {
  workOrderId: string;
  status: WorkOrderStatus;
  canWrite: boolean;
}) {
  const next = NEXT_STEP[status];
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!next || !canWrite) return null;

  async function advance() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/work-orders/${workOrderId}/transition`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetStatus: next!.target }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          data.error === "invalid_transition"
            ? "That transition is not allowed from this status."
            : "Could not update the work order.",
        );
      }
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the work order.");
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="flex items-center gap-2">
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
      <Button size="sm" onClick={() => void advance()} disabled={pending}>
        {pending ? "…" : next.label}
        <ArrowRight aria-hidden className="size-3.5" />
      </Button>
    </span>
  );
}
