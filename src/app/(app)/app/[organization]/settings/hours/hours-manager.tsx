"use client";

import { useEffect, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Window = { weekday: number; openMinute: number; closeMinute: number };

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function minutesToHHMM(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function hhmmToMinutes(value: string): number {
  const [h, m] = value.split(":");
  return Number(h ?? "0") * 60 + Number(m ?? "0");
}

/** Weekly hours + slot capacity per location. Empty days are closed. */
export function HoursManager({
  locations,
  canManage,
}: {
  locations: ReadonlyArray<{ id: string; name: string }>;
  canManage: boolean;
}) {
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [windows, setWindows] = useState<Record<number, { open: string; close: string }>>({});
  const [slotMinutes, setSlotMinutes] = useState("60");
  const [capacity, setCapacity] = useState("1");
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!locationId) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        setLoading(true);
        try {
          const res = await fetch(`/api/locations/${locationId}/hours`);
          if (res.ok && !cancelled) {
            const data = (await res.json()) as {
              hours: Window[];
              slotMinutes: number;
              bookingCapacity: number;
            };
            const next: Record<number, { open: string; close: string }> = {};
            for (const w of data.hours) {
              next[w.weekday] = {
                open: minutesToHHMM(w.openMinute),
                close: minutesToHHMM(w.closeMinute),
              };
            }
            setWindows(next);
            setSlotMinutes(String(data.slotMinutes));
            setCapacity(String(data.bookingCapacity));
          }
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [locationId]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setSuccess(null);
    try {
      const hours = Object.entries(windows).map(([weekday, w]) => ({
        weekday: Number(weekday),
        openMinute: hhmmToMinutes(w.open),
        closeMinute: hhmmToMinutes(w.close),
      }));
      const res = await fetch(`/api/locations/${locationId}/hours`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hours,
          slotMinutes: Number(slotMinutes) || 60,
          bookingCapacity: Number(capacity) || 1,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const messages: Record<string, string> = {
          invalid_window: "Check the open/close times — close must be after open.",
          invalid_weekday: "One day appears twice.",
        };
        throw new Error(messages[data.error] ?? "Could not save hours.");
      }
      setSuccess("Hours saved. New appointments must fall inside them.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save hours.");
    } finally {
      setPending(false);
    }
  }

  if (locations.length === 0) {
    return <p className="text-sm text-muted-foreground">No active locations.</p>;
  }

  return (
    <form onSubmit={save} className="grid gap-6">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {success ? (
        <Alert variant="info">
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      ) : null}

      <label className="grid max-w-xs gap-1 text-sm font-medium">
        Location
        <select
          value={locationId}
          onChange={(e) => setLocationId(e.target.value)}
          disabled={pending}
          className="h-[var(--control-height)] rounded-md border border-input bg-background px-2 text-sm"
        >
          {locations.map((location) => (
            <option key={location.id} value={location.id}>
              {location.name}
            </option>
          ))}
        </select>
      </label>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Weekly hours</CardTitle>
          <CardDescription>Leave a day empty to keep it closed.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
          {WEEKDAYS.map((day, index) => (
            <div key={day} className="flex items-center gap-3">
              <span className="w-24 text-sm font-medium">{day}</span>
              <label className="flex items-center gap-1 text-sm">
                <input
                  type="checkbox"
                  checked={windows[index] !== undefined}
                  onChange={(e) =>
                    setWindows((prev) => {
                      const next = { ...prev };
                      if (e.target.checked) {
                        next[index] = { open: "08:00", close: "17:00" };
                      } else {
                        delete next[index];
                      }
                      return next;
                    })
                  }
                  disabled={pending || !canManage}
                  className="size-4 rounded border-input"
                />
                Open
              </label>
              {windows[index] ? (
                <span className="flex items-center gap-2">
                  <Input
                    type="time"
                    value={windows[index]!.open}
                    onChange={(e) =>
                      setWindows((prev) => ({
                        ...prev,
                        [index]: { ...prev[index]!, open: e.target.value },
                      }))
                    }
                    disabled={pending || !canManage}
                    className="w-28"
                  />
                  <span className="text-muted-foreground">to</span>
                  <Input
                    type="time"
                    value={windows[index]!.close}
                    onChange={(e) =>
                      setWindows((prev) => ({
                        ...prev,
                        [index]: { ...prev[index]!, close: e.target.value },
                      }))
                    }
                    disabled={pending || !canManage}
                    className="w-28"
                  />
                </span>
              ) : (
                <span className="text-sm text-muted-foreground">Closed</span>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Booking</CardTitle>
          <CardDescription>
            How long a booked slot runs and how many visits may overlap (bays, techs).
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm font-medium">
            Slot length (minutes)
            <Input
              type="number"
              min={15}
              max={480}
              step={15}
              value={slotMinutes}
              onChange={(e) => setSlotMinutes(e.target.value)}
              disabled={pending || !canManage}
            />
          </label>
          <label className="grid gap-1 text-sm font-medium">
            Concurrent capacity
            <Input
              type="number"
              min={1}
              max={50}
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              disabled={pending || !canManage}
            />
          </label>
        </CardContent>
      </Card>

      {canManage ? (
        <div>
          <Button type="submit" disabled={pending || loading}>
            {pending ? "Saving…" : "Save hours"}
          </Button>
        </div>
      ) : null}
    </form>
  );
}
