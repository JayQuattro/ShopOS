"use client";

import { useState } from "react";

type Stage = { id: string; label: string };

/** Picks the work order's custom board column; blank = built-in stage. */
export function BoardStageSelect({
  workOrderId,
  stages,
  currentStageId,
  canWrite,
}: {
  workOrderId: string;
  stages: ReadonlyArray<Stage>;
  currentStageId: string | null;
  canWrite: boolean;
}) {
  const [value, setValue] = useState(currentStageId ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(next: string) {
    setValue(next);
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/work-orders/${workOrderId}/board-stage`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stageId: next || null }),
      });
      if (!res.ok) throw new Error("Could not update the stage.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the stage.");
    } finally {
      setPending(false);
    }
  }

  if (stages.length === 0) return null;

  return (
    <div className="mt-2">
      <select
        value={value}
        onChange={(e) => void save(e.target.value)}
        disabled={pending || !canWrite}
        aria-label="Board stage"
        className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
      >
        <option value="">Built-in stage</option>
        {stages.map((stage) => (
          <option key={stage.id} value={stage.id}>
            {stage.label}
          </option>
        ))}
      </select>
      {error ? <p className="mt-1 text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
