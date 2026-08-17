"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";

type Status = "SCHEDULED" | "CONFIRMED" | "CHECKED_IN" | "COMPLETED" | "CANCELLED" | "NO_SHOW";

export function AppointmentActions({
  appointmentId,
  status,
  workOrderId,
  canWrite,
}: {
  appointmentId: string;
  status: Status;
  workOrderId: string | null;
  canWrite: boolean;
}) {
  const [pending, setPending] = useState<string | null>(null);

  async function act(action: "transition" | "convert", payload: Record<string, unknown> = {}) {
    setPending(action + (payload.targetStatus ?? ""));
    try {
      const res = await fetch(`/api/appointments/${appointmentId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        window.alert(body.error ?? "Action failed.");
        return;
      }
      if (action === "convert") {
        const data = await res.json();
        window.location.href = `/app/${window.location.pathname.split("/")[2]}/work-orders/${data.workOrderId}`;
        return;
      }
      window.location.reload();
    } finally {
      setPending(null);
    }
  }

  if (!canWrite) return null;

  const transition = (targetStatus: string, label: string) => (
    <Button
      key={targetStatus}
      variant="outline"
      size="sm"
      disabled={pending !== null}
      onClick={() => void act("transition", { targetStatus })}
    >
      {pending === "transition" + targetStatus ? "…" : label}
    </Button>
  );

  return (
    <div className="flex flex-wrap gap-2">
      {status === "SCHEDULED" ? transition("CONFIRMED", "Confirm") : null}
      {status === "SCHEDULED" || status === "CONFIRMED"
        ? transition("CHECKED_IN", "Check in")
        : null}
      {status === "CHECKED_IN" && !workOrderId ? (
        <Button size="sm" disabled={pending !== null} onClick={() => void act("convert")}>
          {pending === "convert" ? "Creating…" : "Start work order"}
        </Button>
      ) : null}
      {status === "CHECKED_IN" ? transition("COMPLETED", "Complete") : null}
      {status === "SCHEDULED" || status === "CONFIRMED" ? transition("CANCELLED", "Cancel") : null}
      {status === "SCHEDULED" || status === "CONFIRMED" ? transition("NO_SHOW", "No-show") : null}
    </div>
  );
}
