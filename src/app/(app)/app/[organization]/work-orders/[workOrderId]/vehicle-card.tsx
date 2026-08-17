"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const STAGES: ReadonlyArray<{ value: string; label: string }> = [
  { value: "", label: "Not staged" },
  { value: "WAITING", label: "Checked in — waiting for a bay" },
  { value: "IN_BAY", label: "In the bay" },
  { value: "ON_LIFT", label: "On the lift" },
  { value: "TEST_DRIVE", label: "Out on a test drive" },
  { value: "WAITING_PARTS", label: "Waiting on parts" },
  { value: "READY_FOR_PICKUP", label: "Ready for pickup" },
  { value: "PICKED_UP", label: "Picked up" },
];

export function VehicleCard({
  workOrderId,
  stage,
  bayLabel,
  canWrite,
}: {
  workOrderId: string;
  stage: string | null;
  bayLabel: string | null;
  canWrite: boolean;
}) {
  const [selectedStage, setSelectedStage] = useState(stage ?? "");
  const [bay, setBay] = useState(bayLabel ?? "");
  const [pending, setPending] = useState(false);

  const dirty = selectedStage !== (stage ?? "") || bay !== (bayLabel ?? "");

  async function save() {
    setPending(true);
    try {
      await fetch(`/api/work-orders/${workOrderId}/vehicle`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stage: selectedStage === "" ? null : selectedStage,
          bayLabel: bay,
        }),
      });
      window.location.reload();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <select
        value={selectedStage}
        onChange={(e) => setSelectedStage(e.target.value)}
        disabled={!canWrite || pending}
        className="h-[var(--control-height)] w-full rounded-md border border-input bg-background px-2 text-sm"
        aria-label="Vehicle stage"
      >
        {STAGES.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <div className="flex gap-2">
        <Input
          value={bay}
          onChange={(e) => setBay(e.target.value)}
          placeholder="Spot (Bay 2, Lift 3…)"
          disabled={!canWrite || pending}
          className="text-sm"
        />
        {canWrite ? (
          <Button size="sm" variant="outline" onClick={save} disabled={pending || !dirty}>
            {pending ? "…" : "Save"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
