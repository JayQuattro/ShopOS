"use client";

import { PromptDialog } from "@/components/shopos/prompt-dialog";
import { useState } from "react";

import type { TransportStatus } from "@/modules/transport/transport-state-machine";

type Driver = { userId: string; displayName: string };
type FleetVehicle = { id: string; displayName: string };

/** Inline quick actions on a transport card: start the run, complete, cancel. */
export function TransportCardActions({
  orgId,
  jobId,
  status,
  drivers,
  fleetVehicles,
}: {
  orgId: string;
  jobId: string;
  status: TransportStatus;
  drivers: ReadonlyArray<Driver>;
  fleetVehicles: ReadonlyArray<FleetVehicle>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vehicleId, setVehicleId] = useState("");

  async function post(body: Record<string, unknown>) {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/organizations/${orgId}/transport/${jobId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        const messages: Record<string, string> = {
          driver_not_a_member: "That person is not an active member of this organization.",
          invalid_transition: "This run can't move there from its current status.",
        };
        throw new Error(messages[data.error ?? ""] ?? "Action failed.");
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
        {status === "SCHEDULED" ? (
          <>
            <select
              aria-label="Driver"
              defaultValue=""
              disabled={pending}
              onChange={(e) => {
                if (e.target.value) {
                  void post({
                    action: "start",
                    driverUserId: e.target.value,
                    ...(vehicleId ? { fleetAssetId: vehicleId } : {}),
                  });
                }
              }}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            >
              <option value="">Start with…</option>
              {drivers.map((driver) => (
                <option key={driver.userId} value={driver.userId}>
                  {driver.displayName}
                </option>
              ))}
            </select>
            {fleetVehicles.length > 0 ? (
              <select
                aria-label="Shop vehicle"
                value={vehicleId}
                onChange={(e) => setVehicleId(e.target.value)}
                disabled={pending}
                className="h-8 rounded-md border border-input bg-background px-2 text-xs"
              >
                <option value="">Any vehicle</option>
                {fleetVehicles.map((vehicle) => (
                  <option key={vehicle.id} value={vehicle.id}>
                    {vehicle.displayName}
                  </option>
                ))}
              </select>
            ) : null}
          </>
        ) : null}
        {status === "EN_ROUTE" ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => void post({ action: "complete" })}
            className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
          >
            Done — handed over
          </button>
        ) : null}
        <button
          type="button"
          disabled={pending}
          onClick={() => setAskingCancel(true)}
          className="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
      {error ? <p className="mt-1 text-xs text-destructive">{error}</p> : null}
      <PromptDialog
        open={askingCancel}
        title="Cancel this run"
        fields={[
          {
            name: "reason",
            label: "Reason",
            placeholder: "Driver unavailable",
            required: true,
            autoFocus: true,
          },
        ]}
        submitLabel="Cancel run"
        pending={pending}
        onCancel={() => setAskingCancel(false)}
        onSubmit={(values) => void cancel((values.reason ?? "").trim())}
      />
    </div>
  );
}
