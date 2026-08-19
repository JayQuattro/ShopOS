"use client";

import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Holiday = { id: string; date: string; name: string; closesAllDay: boolean };

/** One location's holiday calendar — what closes the shop, by name. */
export function HolidaysManager({
  organizationId,
  locationId,
  locationName,
}: {
  organizationId: string;
  locationId: string;
  locationName: string;
}) {
  const [holidays, setHolidays] = useState<Holiday[] | null>(null);
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const year = new Date().getFullYear();
    const res = await fetch(
      `/api/organizations/${organizationId}/locations/${locationId}/holidays?from=${year}-01-01&to=${year + 1}-12-31`,
    );
    if (res.ok) setHolidays((await res.json()).holidays ?? []);
  }

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      if (!cancelled) void refresh();
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, locationId]);

  async function post(body: Record<string, unknown>) {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/organizations/${organizationId}/locations/${locationId}/holidays`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const messages: Record<string, string> = {
          invalid_date: "Pick a real date (YYYY-MM-DD).",
          invalid_name: "Give the holiday a name.",
        };
        throw new Error(messages[data.error ?? ""] ?? "Could not save the holiday.");
      }
      setName("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the holiday.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Holidays — {locationName}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {holidays === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : holidays.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No holidays configured. Add the days this location closes — the booking calendar refuses
            new appointments on them.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border/60">
            {holidays.map((holiday) => (
              <li
                key={holiday.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
              >
                <span>
                  <span className="font-mono text-xs tabular-nums">{holiday.date}</span>{" "}
                  <span className="ml-2">{holiday.name}</span>
                  {holiday.closesAllDay ? (
                    <Badge variant="secondary" className="ml-2 text-[10px]">
                      closed
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="ml-2 text-[10px]">
                      partial
                    </Badge>
                  )}
                </span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => void post({ action: "delete", holidayId: holiday.id })}
                  className="rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
          <label className="grid gap-1 text-sm font-medium">
            Date
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              disabled={pending}
              className="h-9 w-40 text-sm"
              aria-label={`Holiday date for ${locationName}`}
            />
          </label>
          <label className="grid flex-1 gap-1 text-sm font-medium">
            Name
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Thanksgiving · Boxing Day · saints' day"
              disabled={pending}
              className="h-9 text-sm"
            />
          </label>
          <button
            type="button"
            disabled={pending || !date || name.trim().length < 2}
            onClick={() => void post({ action: "upsert", date, name: name.trim() })}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {pending ? "Saving…" : "Add holiday"}
          </button>
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
