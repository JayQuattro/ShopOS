"use client";

import { useState } from "react";

type Technician = { userId: string; displayName: string };

export function AssignmentSelect({
  workOrderId,
  technicians,
  assignedUserId,
  assisting,
  canWrite,
}: {
  workOrderId: string;
  technicians: ReadonlyArray<Technician>;
  assignedUserId: string | null;
  assisting: ReadonlyArray<Technician>;
  canWrite: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assistingIds, setAssistingIds] = useState<string[]>(
    assisting.map((technician) => technician.userId),
  );
  const [teamDirty, setTeamDirty] = useState(false);

  async function saveTeam(nextIds: string[]) {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/work-orders/${workOrderId}/technicians`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds: nextIds }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          data.error === "technician_not_a_member"
            ? "That person is not an active member of this organization."
            : "Could not update the team.",
        );
      }
      setTeamDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the team.");
    } finally {
      setPending(false);
    }
  }

  function toggleTechnician(userId: string) {
    const next = assistingIds.includes(userId)
      ? assistingIds.filter((id) => id !== userId)
      : [...assistingIds, userId];
    setAssistingIds(next);
    setTeamDirty(true);
    if (next.length === 0 || true) {
      void saveTeam(next);
    }
  }

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
      {technicians.length > 1 ? (
        <div className="flex flex-wrap gap-1">
          {technicians
            .filter((technician) => technician.userId !== assignedUserId)
            .map((technician) => {
              const active = assistingIds.includes(technician.userId);
              return (
                <button
                  key={technician.userId}
                  type="button"
                  disabled={pending || !canWrite}
                  onClick={() => toggleTechnician(technician.userId)}
                  aria-pressed={active}
                  className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
                    active
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {technician.displayName}
                </button>
              );
            })}
        </div>
      ) : null}
      {teamDirty ? <p className="text-xs text-muted-foreground">Saving…</p> : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {!canWrite ? (
        <p className="text-xs text-muted-foreground">You need work-order write access to assign.</p>
      ) : null}
    </div>
  );
}
