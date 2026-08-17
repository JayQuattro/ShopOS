"use client";

import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Option = { id: string; displayName: string; customerId?: string };

export function AppointmentCreateForm({
  customers,
  assets,
  locations,
  date,
}: {
  customers: Option[];
  assets: Option[];
  locations: Option[];
  /** The day being viewed, YYYY-MM-DD; the form defaults to it. */
  date: string;
}) {
  const [open, setOpen] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [assetId, setAssetId] = useState("");
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [reason, setReason] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [durationMinutes, setDurationMinutes] = useState("60");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!customerId || !locationId || !reason.trim() || !startTime) return;
    setPending(true);
    setError(null);
    try {
      // Times are entered in the viewer's zone; the API stores UTC instants.
      const startAt = new Date(`${date}T${startTime}`);
      const endAt = new Date(startAt.getTime() + Number(durationMinutes || 60) * 60_000);
      const res = await fetch("/api/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locationId,
          customerId,
          ...(assetId ? { assetId } : {}),
          reason,
          startAt: startAt.toISOString(),
          endAt: endAt.toISOString(),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const messages: Record<string, string> = {
          invalid_time_range: "The end time must be after the start time.",
          customer_not_found: "That customer does not exist in this organization.",
          asset_not_found: "That asset does not belong to the selected customer.",
        };
        throw new Error(messages[body.error] ?? "Failed to create the appointment.");
      }
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return <Button onClick={() => setOpen(true)}>New appointment</Button>;
  }

  const customerAssets = assets; // The server pre-filters to this org; refine per-customer below.

  return (
    <form onSubmit={handleSubmit} className="grid w-full max-w-lg gap-3">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <label className="grid gap-1 text-sm font-medium">
        Customer
        <select
          value={customerId}
          onChange={(e) => {
            setCustomerId(e.target.value);
            setAssetId("");
          }}
          required
          className="h-[var(--control-height)] rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">Select customer…</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.displayName}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-sm font-medium">
        Asset (optional)
        <select
          value={assetId}
          onChange={(e) => setAssetId(e.target.value)}
          className="h-[var(--control-height)] rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">No specific asset</option>
          {customerAssets
            .filter((a) => !customerId || a.customerId === customerId)
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.displayName}
              </option>
            ))}
        </select>
      </label>
      <label className="grid gap-1 text-sm font-medium">
        Location
        <select
          value={locationId}
          onChange={(e) => setLocationId(e.target.value)}
          required
          className="h-[var(--control-height)] rounded-md border border-input bg-background px-3 text-sm"
        >
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.displayName}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-sm font-medium">
        Reason for visit
        <Input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Oil change, brake inspection…"
          required
        />
      </label>
      <div className="flex gap-2">
        <label className="grid flex-1 gap-1 text-sm font-medium">
          Start time
          <Input
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            required
          />
        </label>
        <label className="grid flex-1 gap-1 text-sm font-medium">
          Duration (minutes)
          <Input
            type="number"
            min={15}
            step={15}
            value={durationMinutes}
            onChange={(e) => setDurationMinutes(e.target.value)}
          />
        </label>
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Scheduling…" : "Schedule"}
        </Button>
        <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
