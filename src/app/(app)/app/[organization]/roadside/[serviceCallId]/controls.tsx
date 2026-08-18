"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { ServiceCallStatus } from "@/modules/service-calls/service-call-state-machine";

type Technician = { userId: string; displayName: string };
type FleetAsset = { id: string; displayName: string };

/**
 * Dispatch and lifecycle controls for one call: assign a technician and shop
 * vehicle, advance status, cancel with a reason, and convert to a work order
 * once the job needs shop time.
 */
export function ServiceCallControls({
  orgId,
  callId,
  status,
  technicians,
  fleetAssets,
  converted,
}: {
  orgId: string;
  callId: string;
  status: ServiceCallStatus;
  technicians: ReadonlyArray<Technician>;
  fleetAssets: ReadonlyArray<FleetAsset>;
  converted: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [technicianUserId, setTechnicianUserId] = useState("");
  const [fleetAssetId, setFleetAssetId] = useState("");
  const [cancelReason, setCancelReason] = useState("");

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
        const messages: Record<string, string> = {
          technician_not_a_member: "That person is not an active member of this organization.",
          invalid_transition: "This call can't move there from its current status.",
          already_converted: "This call already has a work order.",
          terminal_state: "This call is finished.",
        };
        throw new Error(messages[data.error ?? ""] ?? "Action failed.");
      }
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed.");
      setPending(false);
    }
  }

  const open = status !== "COMPLETED" && status !== "CANCELLED";
  const inputClass =
    "h-[var(--control-height)] rounded-md border border-input bg-background px-3 text-sm";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Dispatch</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        {open && status === "REQUESTED" ? (
          <div className="grid gap-3 md:grid-cols-3">
            <label className="grid gap-1 text-sm font-medium">
              Technician *
              <select
                value={technicianUserId}
                onChange={(e) => setTechnicianUserId(e.target.value)}
                className={inputClass}
                disabled={pending}
              >
                <option value="">Select…</option>
                {technicians.map((technician) => (
                  <option key={technician.userId} value={technician.userId}>
                    {technician.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm font-medium">
              Shop vehicle
              <select
                value={fleetAssetId}
                onChange={(e) => setFleetAssetId(e.target.value)}
                className={inputClass}
                disabled={pending}
              >
                <option value="">None</option>
                {fleetAssets.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.displayName}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-end">
              <Button
                type="button"
                disabled={pending || !technicianUserId}
                onClick={() =>
                  void post({
                    action: "dispatch",
                    technicianUserId,
                    ...(fleetAssetId ? { fleetAssetId } : {}),
                  })
                }
              >
                {pending ? "Dispatching…" : "Dispatch"}
              </Button>
            </div>
          </div>
        ) : null}

        {open && status !== "REQUESTED" ? (
          <div className="flex flex-wrap gap-2">
            {status === "DISPATCHED" ? (
              <Button
                type="button"
                disabled={pending}
                onClick={() => void post({ action: "advance", target: "EN_ROUTE" })}
              >
                En route
              </Button>
            ) : null}
            {status === "EN_ROUTE" ? (
              <Button
                type="button"
                disabled={pending}
                onClick={() => void post({ action: "advance", target: "ON_SCENE" })}
              >
                On scene
              </Button>
            ) : null}
            {status === "ON_SCENE" ? (
              <Button
                type="button"
                disabled={pending}
                onClick={() => void post({ action: "advance", target: "COMPLETED" })}
              >
                Complete call
              </Button>
            ) : null}
          </div>
        ) : null}

        {open && status !== "ON_SCENE" ? (
          <div className="grid gap-2 md:grid-cols-3">
            <label className="grid gap-1 text-sm font-medium md:col-span-2">
              Cancel this call — reason *
              <Input
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Customer cancelled / duplicate / towed elsewhere…"
                disabled={pending}
              />
            </label>
            <div className="flex items-end">
              <Button
                type="button"
                variant="outline"
                disabled={pending || cancelReason.trim().length < 3}
                onClick={() => void post({ action: "cancel", reason: cancelReason.trim() })}
              >
                Cancel call
              </Button>
            </div>
          </div>
        ) : null}

        {open && !converted ? (
          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => void post({ action: "convert" })}
            >
              Create work order
            </Button>
            <p className="text-xs text-muted-foreground">
              For jobs that need shop time — inherits the customer and this location.
            </p>
          </div>
        ) : null}

        {!open ? (
          <p className="text-sm text-muted-foreground">
            This call is {status === "COMPLETED" ? "completed" : "cancelled"}.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
