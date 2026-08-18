"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";

type Candidate = { id: string; displayName: string };

/**
 * Fleet membership control: an add picker above the table, a remove button on
 * each row. Removing never deletes the asset — it just stops being preferred
 * by loaner and roadside pickers.
 */
export function FleetToggle({
  candidates,
  assetId,
  assetName,
  add,
}: {
  candidates?: ReadonlyArray<Candidate>;
  assetId?: string;
  assetName?: string;
  add?: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState("");

  async function toggle(assetId: string, isFleetVehicle: boolean) {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/assets/${assetId}/fleet`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isFleetVehicle }),
      });
      if (!res.ok) throw new Error("Could not update fleet membership.");
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update fleet membership.");
      setPending(false);
    }
  }

  if (add && candidates) {
    return (
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-sm font-medium">
          Add a shop vehicle to the fleet
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            disabled={pending}
            className="h-[var(--control-height)] min-w-64 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Pick an asset…</option>
            {candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.displayName}
              </option>
            ))}
          </select>
        </label>
        <Button
          type="button"
          disabled={pending || !selected}
          onClick={() => selected && void toggle(selected, true)}
        >
          {pending ? "Adding…" : "Add to fleet"}
        </Button>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>
    );
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="outline"
        disabled={pending}
        onClick={() => assetId && void toggle(assetId, false)}
      >
        {pending ? "Removing…" : "Remove"}
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {assetName ? <span className="sr-only">{assetName}</span> : null}
    </span>
  );
}
