"use client";

import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export function WorkOrderEditForm({
  workOrderId,
  initialConcern,
  canWrite,
}: {
  workOrderId: string;
  initialConcern: string;
  canWrite: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [concern, setConcern] = useState(initialConcern);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/work-orders/${workOrderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerConcern: concern }),
      });
      if (!res.ok) throw new Error("Failed to save");
      setEditing(false);
      window.location.reload();
    } catch {
      setError("Could not save changes.");
    } finally {
      setPending(false);
    }
  }

  if (!canWrite) return null;

  if (!editing) {
    return (
      <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
        Edit
      </Button>
    );
  }

  return (
    <form onSubmit={handleSave} className="grid gap-3">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <textarea
        aria-label="Customer concern"
        value={concern}
        onChange={(e) => setConcern(e.target.value)}
        disabled={pending}
        className="min-h-20 rounded-md border border-input bg-background p-3 text-sm"
      />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          Save
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setEditing(false)}
          disabled={pending}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
