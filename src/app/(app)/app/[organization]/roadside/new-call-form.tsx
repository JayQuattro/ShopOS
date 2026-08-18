"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type CustomerOption = { id: string; displayName: string };
type LocationOption = { id: string; name: string };

const KINDS = [
  ["JUMPSTART", "Jumpstart"],
  ["TIRE_CHANGE", "Tire change"],
  ["FUEL_DELIVERY", "Fuel delivery"],
  ["LOCKOUT", "Lockout"],
  ["BATTERY", "Battery"],
  ["TOW_COORDINATION", "Tow coordination"],
  ["MOBILE_REPAIR", "Mobile repair"],
  ["OTHER", "Other"],
] as const;

/** Collapsible intake form for a new roadside call. */
export function NewServiceCallForm({
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

  const [customerId, setCustomerId] = useState("");
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [kind, setKind] = useState<string>("JUMPSTART");
  const [contactPhone, setContactPhone] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [city, setCity] = useState("");
  const [stateProvince, setStateProvince] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [note, setNote] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/organizations/${orgId}/service-calls`, {
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
          ...(note ? { note } : {}),
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        const messages: Record<string, string> = {
          invalid_body: "Fill in the customer, phone, and service address.",
          customer_not_found: "Pick a customer (create one first if needed).",
          location_not_found: "Pick which location dispatches this call.",
        };
        throw new Error(messages[data.error ?? ""] ?? "Could not create the call.");
      }
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the call.");
      setPending(false);
    }
  }

  const inputClass =
    "h-[var(--control-height)] rounded-md border border-input bg-background px-3 text-sm";

  return (
    <Card>
      <CardHeader className="cursor-pointer py-4" onClick={() => setOpen((prev) => !prev)}>
        <CardTitle className="flex items-center justify-between text-base">
          New service call
          <span className="text-xs font-normal text-muted-foreground">
            {open ? "Hide" : "Take a call"}
          </span>
        </CardTitle>
      </CardHeader>
      {open ? (
        <CardContent>
          <form onSubmit={submit} className="grid gap-3 md:grid-cols-2">
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
              Dispatching from *
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
              Kind *
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value)}
                className={inputClass}
                disabled={pending}
              >
                {KINDS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
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
            <label className="grid gap-1 text-sm font-medium md:col-span-2">
              Service address *
              <Input
                required
                value={addressLine1}
                onChange={(e) => setAddressLine1(e.target.value)}
                placeholder="Street address — where the vehicle is"
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
                placeholder="What happened, vehicle details, landmarks…"
                disabled={pending}
              />
            </label>
            {error ? <p className="text-sm text-destructive md:col-span-2">{error}</p> : null}
            <div className="md:col-span-2">
              <Button type="submit" disabled={pending || !customerId || !locationId}>
                {pending ? "Creating…" : "Take the call"}
              </Button>
            </div>
          </form>
        </CardContent>
      ) : null}
    </Card>
  );
}
