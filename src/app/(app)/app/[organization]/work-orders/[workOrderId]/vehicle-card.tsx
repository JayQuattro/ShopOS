"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type AssetOption = { id: string; displayName: string; customerId: string };

const STAGES = [
  ["WAITING", "Checked in"],
  ["IN_BAY", "In the bay"],
  ["ON_LIFT", "On the lift"],
  ["TEST_DRIVE", "Test drive"],
  ["WAITING_PARTS", "Waiting on parts"],
  ["READY_FOR_PICKUP", "Ready for pickup"],
  ["PICKED_UP", "Picked up"],
] as const;

/** Vehicle + custody card: which vehicle, which bay, where it is. */
export function VehicleCard({
  workOrderId,
  stage,
  bayLabel,
  currentAssetId,
  customerAssets,
  canWrite,
}: {
  workOrderId: string;
  locationId: string;
  stage: string | null;
  bayLabel: string | null;
  currentAssetId: string | null;
  customerAssets: ReadonlyArray<AssetOption>;
  canWrite: boolean;
}) {
  const [selectedStage, setSelectedStage] = useState(stage ?? "");
  const [bay, setBay] = useState(bayLabel ?? "");
  const [assetId, setAssetId] = useState(currentAssetId ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveVehicle(nextAssetId: string | null) {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/work-orders/${workOrderId}/asset`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId: nextAssetId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const messages: Record<string, string> = {
          asset_not_for_customer: "That vehicle belongs to a different customer.",
        };
        throw new Error(messages[data.error ?? ""] ?? "Could not update the vehicle.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the vehicle.");
    } finally {
      setPending(false);
    }
  }

  async function saveStage() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/work-orders/${workOrderId}/vehicle`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(selectedStage ? { stage: selectedStage } : { stage: null }),
          bayLabel: bay.trim() || null,
        }),
      });
      if (!res.ok) throw new Error("Could not update the stage.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the stage.");
    } finally {
      setPending(false);
    }
  }

  const select =
    "h-[var(--control-height)] rounded-md border border-input bg-background px-2 text-sm";
  const dirty = selectedStage !== (stage ?? "") || bay !== (bayLabel ?? "");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Vehicle</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {canWrite ? (
          <label className="grid gap-1 text-sm font-medium">
            Vehicle on this job
            <select
              value={assetId}
              onChange={(e) => {
                setAssetId(e.target.value);
                void saveVehicle(e.target.value || null);
              }}
              disabled={pending}
              className={select}
              aria-label="Vehicle on this job"
            >
              <option value="">No vehicle — general work</option>
              {customerAssets.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.displayName}
                </option>
              ))}
            </select>
            {customerAssets.length === 0 ? (
              <span className="text-xs text-muted-foreground">
                No vehicles for this customer — add one from their profile.
              </span>
            ) : null}
          </label>
        ) : null}

        {canWrite ? (
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid gap-1 text-sm font-medium">
              Stage
              <select
                value={selectedStage}
                onChange={(e) => setSelectedStage(e.target.value)}
                disabled={pending}
                className={select}
                aria-label="Vehicle stage"
              >
                <option value="">Not checked in</option>
                {STAGES.map(([value, text]) => (
                  <option key={value} value={value}>
                    {text}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm font-medium">
              Bay
              <Input
                value={bay}
                onChange={(e) => setBay(e.target.value)}
                placeholder="Bay 2"
                disabled={pending}
                className="h-[var(--control-height)] w-28 text-sm"
                aria-label="Bay"
              />
            </label>
            {dirty ? (
              <button
                type="button"
                onClick={() => void saveStage()}
                disabled={pending}
                className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                {pending ? "Saving…" : "Save"}
              </button>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {stage ? (
              <Badge variant="secondary">
                {STAGES.find(([value]) => value === stage)?.[1] ?? stage}
              </Badge>
            ) : null}
            {bayLabel ? <Badge variant="outline">{bayLabel}</Badge> : null}
          </div>
        )}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
