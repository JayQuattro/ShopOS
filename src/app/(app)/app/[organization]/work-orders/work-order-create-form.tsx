"use client";

import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

type Option = { id: string; displayName: string };

export function WorkOrderCreateForm({
  customers,
  assets,
  locations,
}: {
  customers: Option[];
  assets: Option[];
  locations: Option[];
}) {
  const [open, setOpen] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [assetId, setAssetId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [workType, setWorkType] = useState("REPAIR");
  const [concern, setConcern] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!customerId || !assetId || !locationId || !concern.trim()) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/work-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId,
          assetId,
          locationId,
          workType,
          customerConcern: concern,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to create work order.");
      }
      const data = await res.json();
      window.location.href = `/app/${window.location.pathname.split("/")[2]}/work-orders/${data.workOrder.id}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return <Button onClick={() => setOpen(true)}>New work order</Button>;
  }

  return (
    <form onSubmit={handleSubmit} className="grid w-full max-w-lg gap-3">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <label className="text-sm font-medium">Customer</label>
      <select
        value={customerId}
        onChange={(e) => setCustomerId(e.target.value)}
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
      <label className="text-sm font-medium">Asset</label>
      <select
        value={assetId}
        onChange={(e) => setAssetId(e.target.value)}
        required
        className="h-[var(--control-height)] rounded-md border border-input bg-background px-3 text-sm"
      >
        <option value="">Select asset…</option>
        {assets.map((a) => (
          <option key={a.id} value={a.id}>
            {a.displayName}
          </option>
        ))}
      </select>
      <label className="text-sm font-medium">Location</label>
      <select
        value={locationId}
        onChange={(e) => setLocationId(e.target.value)}
        required
        className="h-[var(--control-height)] rounded-md border border-input bg-background px-3 text-sm"
      >
        <option value="">Select location…</option>
        {locations.map((l) => (
          <option key={l.id} value={l.id}>
            {l.displayName}
          </option>
        ))}
      </select>
      <label className="text-sm font-medium">Work type</label>
      <select
        value={workType}
        onChange={(e) => setWorkType(e.target.value)}
        className="h-[var(--control-height)] rounded-md border border-input bg-background px-3 text-sm"
      >
        <option value="REPAIR">Repair</option>
        <option value="MAINTENANCE">Maintenance</option>
        <option value="PROJECT">Project</option>
      </select>
      <label className="text-sm font-medium">Customer concern</label>
      <textarea
        value={concern}
        onChange={(e) => setConcern(e.target.value)}
        required
        minLength={1}
        maxLength={2000}
        className="min-h-20 rounded-md border border-input bg-background p-3 text-sm"
        placeholder="What does the customer need?"
      />
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          Create work order
        </Button>
        <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
