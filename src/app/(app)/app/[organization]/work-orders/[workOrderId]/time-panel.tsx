"use client";

import { useEffect, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatDateTime } from "@/i18n/formatters";

type TimeEntry = {
  id: string;
  userDisplayName: string;
  startedAt: string;
  endedAt: string | null;
  minutes: number | null;
  note: string | null;
};

function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0 ? `${hours}h ${rest}m` : `${rest}m`;
}

export function TimePanel({
  workOrderId,
  timeZone,
  technicians,
  canWrite,
}: {
  workOrderId: string;
  timeZone: string;
  technicians: ReadonlyArray<{ userId: string; displayName: string }>;
  canWrite: boolean;
}) {
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [runningHere, setRunningHere] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [manualOpen, setManualOpen] = useState(false);
  const [manualUser, setManualUser] = useState(technicians[0]?.userId ?? "");
  const [manualDate, setManualDate] = useState(new Date().toISOString().slice(0, 10));
  const [manualStart, setManualStart] = useState("09:00");
  const [manualEnd, setManualEnd] = useState("10:00");
  const [manualNote, setManualNote] = useState("");

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      async function load() {
        try {
          const res = await fetch(`/api/work-orders/${workOrderId}/time-entries`);
          if (res.ok && !cancelled) {
            const data = await res.json();
            setEntries(data.entries ?? []);
            setRunningHere(Boolean(data.runningOnThisWorkOrder));
          }
        } finally {
          if (!cancelled) setLoading(false);
        }
      }
      void load();
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [workOrderId]);

  async function act(body: Record<string, unknown>) {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/work-orders/${workOrderId}/time-entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const messages: Record<string, string> = {
          timer_already_running: "You already have a running timer — stop it first.",
          no_running_timer: "No running timer to stop.",
          invalid_time_range: "The end time must be after the start time.",
          user_not_a_member: "That person is not an active member of this organization.",
        };
        throw new Error(messages[data.error] ?? "Action failed.");
      }
      const refresh = await fetch(`/api/work-orders/${workOrderId}/time-entries`);
      if (refresh.ok) {
        const data = await refresh.json();
        setEntries(data.entries ?? []);
        setRunningHere(Boolean(data.runningOnThisWorkOrder));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed.");
    } finally {
      setPending(false);
    }
  }

  async function remove(entryId: string) {
    if (!window.confirm("Delete this time entry?")) return;
    setPending(true);
    try {
      const res = await fetch(`/api/work-orders/${workOrderId}/time-entries?entryId=${entryId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setEntries((prev) => prev.filter((entry) => entry.id !== entryId));
      }
    } finally {
      setPending(false);
    }
  }

  const totalMinutes = entries.reduce((sum, entry) => sum + (entry.minutes ?? 0), 0);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">
          Time
          {totalMinutes > 0 ? (
            <span className="ml-2 font-mono text-sm text-muted-foreground">
              {formatDuration(totalMinutes)} logged
            </span>
          ) : null}
        </CardTitle>
        {canWrite ? (
          <div className="flex gap-2">
            {runningHere ? (
              <Button
                size="sm"
                variant="default"
                disabled={pending}
                onClick={() => void act({ action: "stop" })}
              >
                Stop timer
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => void act({ action: "start" })}
              >
                Start timer
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => setManualOpen((open) => !open)}
            >
              Log time
            </Button>
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {manualOpen && canWrite ? (
          <form
            className="flex flex-wrap items-end gap-2 rounded-md border border-border p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void act({
                action: "manual",
                userId: manualUser,
                startedAt: new Date(`${manualDate}T${manualStart}`).toISOString(),
                endedAt: new Date(`${manualDate}T${manualEnd}`).toISOString(),
                ...(manualNote.trim() ? { note: manualNote.trim() } : {}),
              });
            }}
          >
            <label className="grid gap-1 text-sm font-medium">
              Who
              <select
                value={manualUser}
                onChange={(e) => setManualUser(e.target.value)}
                className="h-[var(--control-height)] rounded-md border border-input bg-background px-2 text-sm"
              >
                {technicians.map((technician) => (
                  <option key={technician.userId} value={technician.userId}>
                    {technician.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm font-medium">
              Date
              <Input
                type="date"
                value={manualDate}
                onChange={(e) => setManualDate(e.target.value)}
                className="w-36"
              />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              From
              <Input
                type="time"
                value={manualStart}
                onChange={(e) => setManualStart(e.target.value)}
                className="w-24"
              />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              To
              <Input
                type="time"
                value={manualEnd}
                onChange={(e) => setManualEnd(e.target.value)}
                className="w-24"
              />
            </label>
            <label className="grid flex-1 gap-1 text-sm font-medium">
              Note
              <Input
                value={manualNote}
                onChange={(e) => setManualNote(e.target.value)}
                placeholder="Optional"
              />
            </label>
            <Button type="submit" size="sm" disabled={pending}>
              Save entry
            </Button>
          </form>
        ) : null}

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading time entries…</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">No time logged yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Who</th>
                <th className="py-2 pr-4 font-medium">Started</th>
                <th className="py-2 pr-4 font-medium">Ended</th>
                <th className="py-2 pr-4 font-medium text-right">Duration</th>
                <th className="py-2 pr-4 font-medium">Note</th>
                {canWrite ? <th className="py-2 font-medium" /> : null}
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="border-b border-border/60">
                  <td className="py-2 pr-4">{entry.userDisplayName}</td>
                  <td className="py-2 pr-4 font-mono text-xs tabular-nums">
                    {formatDateTime(new Date(entry.startedAt), timeZone, "en-US")}
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs tabular-nums">
                    {entry.endedAt ? (
                      formatDateTime(new Date(entry.endedAt), timeZone, "en-US")
                    ) : (
                      <Badge variant="secondary">running</Badge>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-right font-mono tabular-nums">
                    {entry.minutes !== null ? formatDuration(entry.minutes) : "—"}
                  </td>
                  <td className="py-2 pr-4 text-muted-foreground">{entry.note ?? ""}</td>
                  {canWrite ? (
                    <td className="py-2 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => void remove(entry.id)}
                        disabled={pending}
                      >
                        Delete
                      </Button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
