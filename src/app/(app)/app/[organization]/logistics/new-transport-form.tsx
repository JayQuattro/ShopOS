"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type CustomerOption = { id: string; displayName: string };
type LocationOption = { id: string; name: string };

/** Collapsible intake form for scheduling a pickup or delivery run. */
export function NewTransportForm({
  orgId,
  customers,
  locations,
}: {
  orgId: string;
  customers: ReadonlyArray<CustomerOption>;
  locations: ReadonlyArray<LocationOption>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [kind, setKind] = useState<"PICKUP" | "DELIVERY">("PICKUP");
  const [customerId, setCustomerId] = useState("");
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [contactPhone, setContactPhone] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [city, setCity] = useState("");
  const [stateProvince, setStateProvince] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [note, setNote] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/organizations/${orgId}/transport`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locationId,
          customerId,
          kind,
          contactPhone,
          addressLine1,
          city,
          stateProvince,
          postalCode,
          ...(scheduledAt ? { scheduledAt: new Date(scheduledAt).toISOString() } : {}),
          ...(note ? { note } : {}),
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        const messages: Record<string, string> = {
          invalid_body: "Fill in the customer, phone, and address.",
          customer_not_found: "Pick a customer.",
          location_not_found: "Pick which location handles this run.",
        };
        throw new Error(messages[data.error ?? ""] ?? "Could not schedule the run.");
      }
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not schedule the run.");
      setPending(false);
    }
  }

  const inputClass =
    "h-[var(--control-height)] rounded-md border border-input bg-background px-3 text-sm";

  return (
    <Card>
      <CardHeader className="cursor-pointer py-4" onClick={() => setOpen((prev) => !prev)}>
        <CardTitle className="flex items-center justify-between text-base">
          Schedule a run
          <span className="text-xs font-normal text-muted-foreground">
            {open ? "Hide" : "Pickup or delivery"}
          </span>
        </CardTitle>
      </CardHeader>
      {open ? (
        <CardContent>
          <form onSubmit={submit} className="grid gap-3 md:grid-cols-2">
            <div className="flex gap-2 md:col-span-2" role="group" aria-label="Run type">
              {(["PICKUP", "DELIVERY"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setKind(value)}
                  aria-pressed={kind === value}
                  className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                    kind === value
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {value === "PICKUP"
                    ? "Pickup — fetch the vehicle"
                    : "Delivery — return the vehicle"}
                </button>
              ))}
            </div>
            <label className="grid gap-1 text-sm font-medium">
              Customer *
              <select
                required
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                className={inputClass}
                disabled={pending}
              >
                <option value="">Select customer…</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm font-medium">
              Handled by *
              <select
                required
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                className={inputClass}
                disabled={pending}
              >
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm font-medium">
              Contact phone *
              <Input
                required
                type="tel"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                placeholder="+1 555 010 1234"
                disabled={pending}
              />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              When
              <Input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                disabled={pending}
              />
            </label>
            <label className="grid gap-1 text-sm font-medium md:col-span-2">
              {kind === "PICKUP" ? "Pickup address *" : "Delivery address *"}
              <Input
                required
                value={addressLine1}
                onChange={(e) => setAddressLine1(e.target.value)}
                placeholder={
                  kind === "PICKUP" ? "Where the vehicle is waiting" : "Where the vehicle is going"
                }
                disabled={pending}
              />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              City *
              <Input
                required
                value={city}
                onChange={(e) => setCity(e.target.value)}
                disabled={pending}
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-1 text-sm font-medium">
                State / province *
                <Input
                  required
                  value={stateProvince}
                  onChange={(e) => setStateProvince(e.target.value)}
                  disabled={pending}
                />
              </label>
              <label className="grid gap-1 text-sm font-medium">
                Postal code *
                <Input
                  required
                  value={postalCode}
                  onChange={(e) => setPostalCode(e.target.value)}
                  disabled={pending}
                />
              </label>
            </div>
            <label className="grid gap-1 text-sm font-medium md:col-span-2">
              Note
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Gate code, where the keys are, who to call…"
                disabled={pending}
              />
            </label>
            {error ? <p className="text-sm text-destructive md:col-span-2">{error}</p> : null}
            <div className="md:col-span-2">
              <Button type="submit" disabled={pending || !customerId || !locationId}>
                {pending ? "Scheduling…" : "Schedule run"}
              </Button>
            </div>
          </form>
        </CardContent>
      ) : null}
    </Card>
  );
}
