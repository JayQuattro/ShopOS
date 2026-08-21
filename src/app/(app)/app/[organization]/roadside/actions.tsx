"use client";

import { PromptDialog } from "@/components/shopos/prompt-dialog";
import { useState } from "react";

import type { ServiceCallStatus } from "@/modules/service-calls/service-call-state-machine";

type Technician = { userId: string; displayName: string };

const NEXT_ACTION: Partial<Record<ServiceCallStatus, { target: string; label: string }>> = {
  DISPATCHED: { target: "EN_ROUTE", label: "En route" },
  EN_ROUTE: { target: "ON_SCENE", label: "On scene" },
  ON_SCENE: { target: "COMPLETED", label: "Complete" },
};

/** Inline quick actions on a board card: dispatch or advance, and cancel. */
export function RoadsideCardActions({
  orgId,
  callId,
  status,
  technicians,
}: {
  orgId: string;
  callId: string;
  status: ServiceCallStatus;
  technicians: ReadonlyArray<Technician>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const next = NEXT_ACTION[status];

  async function post(body: Record<string, unknown>) {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/organizations/${orgId}/service-calls/${callId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Action failed.");
      }
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed.");
      setPending(false);
    }
  }

  const [askingCancel, setAskingCancel] = useState(false);

  async function cancel(reason: string) {
    await post({ action: "cancel", reason });
    setAskingCancel(false);
  }

  return (
    <div className="mt-2 border-t border-border pt-2">
      <div className="flex flex-wrap items-center gap-2">
        {status === "REQUESTED" ? (
          <select
            aria-label="Dispatch technician"
            defaultValue=""
            disabled={pending}
            onChange={(e) => {
              if (e.target.value)
                void post({ action: "dispatch", technicianUserId: e.target.value });
            }}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
          >
            <option value="">Dispatch…</option>
            {technicians.map((technician) => (
              <option key={technician.userId} value={technician.userId}>
                {technician.displayName}
              </option>
            ))}
          </select>
        ) : null}
        {next ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => void post({ action: "advance", target: next.target })}
            className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
          >
            {next.label}
          </button>
        ) : null}
        {status !== "ON_SCENE" && status !== "COMPLETED" && status !== "CANCELLED" ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => setAskingCancel(true)}
            className="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
          >
            Cancel
          </button>
        ) : null}
      </div>
      {error ? <p className="mt-1 text-xs text-destructive">{error}</p> : null}
      <PromptDialog
        open={askingCancel}
        title="Cancel this service call"
        fields={[
          {
            name: "reason",
            label: "Reason",
            placeholder: "Customer cancelled — went with another provider",
            required: true,
            autoFocus: true,
          },
        ]}
        submitLabel="Cancel call"
        pending={pending}
        onCancel={() => setAskingCancel(false)}
        onSubmit={(values) => void cancel((values.reason ?? "").trim())}
      />
    </div>
  );
}
