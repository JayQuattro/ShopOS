"use client";

import { useEffect, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Schedule = {
  id: string;
  name: string;
  intervalMiles: number | null;
  intervalMonths: number | null;
  lastServicedAt: string | null;
  lastServicedMileage: number | null;
  mileage: number | null;
  dueState: "due" | "due_soon" | "ok";
  monthsElapsed: number | null;
  milesElapsed: number | null;
};

/**
 * Preventive maintenance for one asset: schedules with due states, serviced
 * marking, and the odometer that drives mileage-based due math.
 */
export function MaintenancePanel({
  assetId,
  isAutomobile,
  canWrite,
}: {
  assetId: string;
  isAutomobile: boolean;
  canWrite: boolean;
}) {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [mileage, setMileage] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState("");
  const [intervalMiles, setIntervalMiles] = useState("");
  const [intervalMonths, setIntervalMonths] = useState("");
  const [lastMileage, setLastMileage] = useState("");

  async function load() {
    const res = await fetch(`/api/assets/${assetId}/maintenance`);
    if (res.ok) {
      const data = await res.json();
      setSchedules(data.schedules ?? []);
      const first = data.schedules?.[0];
      if (first?.mileage !== null && first?.mileage !== undefined && mileage === "") {
        setMileage(String(first.mileage));
      }
    }
  }

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(`/api/assets/${assetId}/maintenance`);
          if (res.ok && !cancelled) {
            const data = await res.json();
            setSchedules(data.schedules ?? []);
            const first = data.schedules?.[0];
            if (first?.mileage !== null && first?.mileage !== undefined) {
              setMileage(String(first.mileage));
            }
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
  }, [assetId]);

  async function act(body: Record<string, unknown>, successNote: string) {
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/assets/${assetId}/maintenance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const messages: Record<string, string> = {
          duplicate_schedule: "A schedule with that name already exists on this vehicle.",
          invalid_interval: "Give the schedule miles, months, or both.",
          schedule_not_found: "That schedule no longer exists.",
        };
        throw new Error(messages[data.error] ?? "Action failed.");
      }
      setNotice(successNote);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed.");
    } finally {
      setPending(false);
    }
  }

  const dueCount = schedules.filter((schedule) => schedule.dueState !== "ok").length;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">
          Maintenance
          {dueCount > 0 ? (
            <Badge variant="destructive" className="ml-2">
              {dueCount} due
            </Badge>
          ) : null}
        </CardTitle>
        {canWrite ? (
          <Button size="sm" variant="outline" onClick={() => setFormOpen((open) => !open)}>
            Add schedule
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {notice ? (
          <Alert variant="info">
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        ) : null}
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {isAutomobile ? (
          <div className="flex items-end gap-2">
            <label className="grid flex-1 gap-1 text-sm font-medium">
              Odometer
              <Input
                type="number"
                min={0}
                value={mileage}
                onChange={(e) => setMileage(e.target.value)}
                placeholder="Current mileage"
                disabled={pending || !canWrite}
              />
            </label>
            <Button
              size="sm"
              variant="outline"
              disabled={pending || !canWrite || !mileage}
              onClick={() =>
                void act({ action: "mileage", mileage: Number(mileage) }, "Odometer updated.")
              }
            >
              Update
            </Button>
          </div>
        ) : null}

        {formOpen && canWrite ? (
          <form
            className="grid gap-2 rounded-md border border-border p-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) return;
              void act(
                {
                  action: "create",
                  name: name.trim(),
                  ...(intervalMiles ? { intervalMiles: Number(intervalMiles) } : {}),
                  ...(intervalMonths ? { intervalMonths: Number(intervalMonths) } : {}),
                  ...(lastMileage ? { lastServicedMileage: Number(lastMileage) } : {}),
                },
                `Schedule "${name.trim()}" added.`,
              ).then(() => {
                setName("");
                setIntervalMiles("");
                setIntervalMonths("");
                setLastMileage("");
                setFormOpen(false);
              });
            }}
          >
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Service (e.g. Oil change)"
              required

              aria-label="Service"
            />
            <div className="flex flex-wrap gap-2">
              {isAutomobile ? (
                <Input
                  type="number"
                  min={1}
                  value={intervalMiles}
                  onChange={(e) => setIntervalMiles(e.target.value)}
                  placeholder="Every N miles"
                  className="w-32"

                  aria-label="Every N miles"
                />
              ) : null}
              <Input
                type="number"
                min={1}
                value={intervalMonths}
                onChange={(e) => setIntervalMonths(e.target.value)}
                placeholder="Every N months"
                className="w-32"

                aria-label="Every N months"
              />
              {isAutomobile ? (
                <Input
                  type="number"
                  min={0}
                  value={lastMileage}
                  onChange={(e) => setLastMileage(e.target.value)}
                  placeholder="Last done at mileage"
                  className="w-40"

                  aria-label="Last done at mileage"
                />
              ) : null}
            </div>
            <div>
              <Button type="submit" size="sm" disabled={pending || !name.trim()}>
                Save schedule
              </Button>
            </div>
          </form>
        ) : null}

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : schedules.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No maintenance schedules yet. Add recurring services and customers get automatic
            reminders when they come due.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {schedules.map((schedule) => (
              <li
                key={schedule.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
              >
                <div>
                  <p className="text-sm font-medium">
                    {schedule.name}
                    {schedule.dueState === "due" ? (
                      <Badge variant="destructive" className="ml-2 text-[10px]">
                        due
                      </Badge>
                    ) : schedule.dueState === "due_soon" ? (
                      <Badge variant="secondary" className="ml-2 text-[10px]">
                        due soon
                      </Badge>
                    ) : null}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Every{" "}
                    {schedule.intervalMiles ? `${schedule.intervalMiles.toLocaleString()} mi` : ""}
                    {schedule.intervalMiles && schedule.intervalMonths ? " or " : ""}
                    {schedule.intervalMonths ? `${schedule.intervalMonths} mo` : ""}
                    {schedule.lastServicedMileage !== null
                      ? ` · last at ${schedule.lastServicedMileage.toLocaleString()} mi`
                      : schedule.lastServicedAt
                        ? ` · last ${new Date(schedule.lastServicedAt).toLocaleDateString("en-US")}`
                        : " · never recorded"}
                    {schedule.milesElapsed !== null && schedule.intervalMiles
                      ? ` · ${schedule.milesElapsed.toLocaleString()} since`
                      : ""}
                  </p>
                </div>
                {canWrite ? (
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() => {
                        const current = mileage ? Number(mileage) : undefined;
                        void act(
                          {
                            action: "serviced",
                            scheduleId: schedule.id,
                            ...(current !== undefined && !Number.isNaN(current)
                              ? { mileage: current }
                              : {}),
                          },
                          `${schedule.name} marked serviced.`,
                        );
                      }}
                    >
                      Mark serviced
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-muted-foreground hover:text-destructive"
                      disabled={pending}
                      onClick={() =>
                        void act({ action: "delete", scheduleId: schedule.id }, "Schedule removed.")
                      }
                    >
                      Delete
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
