"use client";

import { useState } from "react";

type Technician = { userId: string; displayName: string };

export function AssignmentSelect({
  workOrderId,
  technicians,
  assignedUserId,
  canWrite,
}: {
  workOrderId: string;
  technicians: ReadonlyArray<Technician>;
  assignedUserId: string | null;
  canWrite: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function assign(userId: string | null) {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/work-orders/${workOrderId}/assignment`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const messages: Record<string, string> = {
          technician_not_a_member: "That person is not an active member of this organization.",
          work_order_not_found: "This work order no longer exists.",
        };
        throw new Error(messages[data.error] ?? "Could not update the assignment.");
      }
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the assignment.");
    } finally {
      setPending(false);
    }
  }

  if (technicians.length === 0 && !assignedUserId) {
    return <p className="text-sm text-muted-foreground">No assignable technicians yet.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <select
          value={assignedUserId ?? ""}
          onChange={(e) => void assign(e.target.value === "" ? null : e.target.value)}
          disabled={pending || !canWrite}
          className="h-[var(--control-height)] w-full rounded-md border border-input bg-background px-3 text-sm"
          aria-label="Assigned technician"
        >
          <option value="">Unassigned</option>
          {technicians.map((technician) => (
            <option key={technician.userId} value={technician.userId}>
              {technician.displayName}
            </option>
          ))}
        </select>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {!canWrite ? (
        <p className="text-xs text-muted-foreground">You need work-order write access to assign.</p>
      ) : null}
    </div>
  );
}
