"use client";

import { useMemo, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type Option = { id: string; displayName: string };

/**
 * New work order — wide, labeled, and scoped: the vehicle list follows the
 * chosen customer (never anyone else's), concern is optional ("write it
 * later" is a real workflow), and every field has room.
 */
export function WorkOrderCreateForm({
  customers,
  assets,
  locations,
  startOpen = false,
}: {
  customers: ReadonlyArray<Option>;
  assets: ReadonlyArray<Option & { customerId: string }>;
  locations: ReadonlyArray<{ id: string; displayName: string }>;
  startOpen?: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  const [customerId, setCustomerId] = useState("");
  const [assetId, setAssetId] = useState("");
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [workType, setWorkType] = useState("REPAIR");
  const [concern, setConcern] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only the chosen customer's vehicles — assignment is scoped at the UI
  // boundary and re-validated server-side.
  const customerAssets = useMemo(
    () => assets.filter((asset) => !customerId || asset.customerId === customerId),
    [assets, customerId],
  );

  // An asset picked for a previous customer is simply invalid now —
  // derived, not synced: it won't submit and the select shows the placeholder.
  const effectiveAssetId = customerAssets.some((asset) => asset.id === assetId) ? assetId : "";

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!customerId || !locationId) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/work-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId,
          locationId,
          workType,
          // Empty concern is allowed; the server fills a sensible default.
          customerConcern: concern.trim() || "To be documented",
          ...(effectiveAssetId ? { assetId: effectiveAssetId } : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const messages: Record<string, string> = {
          customer_not_found: "That customer no longer exists.",
          asset_not_found: "That vehicle doesn't belong to this customer.",
          location_not_found: "Pick which shop handles this job.",
        };
        throw new Error(messages[body.error ?? ""] ?? "Failed to create work order.");
      }
      const data = await res.json();
      window.location.href = `/app/${window.location.pathname.split("/")[2]}/work-orders/${data.workOrder.id}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setPending(false);
    }
  }

  function collapse() {
    setOpen(false);
    // Drop ?new=1 so a refresh doesn't force the form back open.
    if (startOpen && window.location.search.includes("new=1")) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }

  if (!open) {
    return <Button onClick={() => setOpen(true)}>New work order</Button>;
  }

  const label = "grid gap-1 text-sm font-medium";
  const select =
    "h-[var(--control-height)] rounded-md border border-input bg-background px-3 text-sm";

  return (
    <Card>
      <CardContent className="pt-6">
        <form onSubmit={handleSubmit} className="grid w-full gap-4 md:grid-cols-2">
          {error ? (
            <Alert variant="destructive" className="md:col-span-2">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <label className={label}>
            Customer *
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              required
              className={select}
            >
              <option value="">Select customer…</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.displayName}
                </option>
              ))}
            </select>
          </label>

          <label className={label}>
            Vehicle
            <select
              value={effectiveAssetId}
              onChange={(e) => setAssetId(e.target.value)}
              className={select}
              disabled={!customerId}
            >
              <option value="">
                {customerId ? "No vehicle — general work" : "Pick a customer first"}
              </option>
              {customerAssets.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.displayName}
                </option>
              ))}
            </select>
            {customerId && customerAssets.length === 0 ? (
              <span className="text-xs text-muted-foreground">
                No vehicles on file — add one from the customer&apos;s profile.
              </span>
            ) : null}
          </label>

          <label className={label}>
            Shop handling the job *
            <select
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              required
              className={select}
            >
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.displayName}
                </option>
              ))}
            </select>
            <span className="text-xs text-muted-foreground">
              For roadside jobs, pick your home shop — the dispatch lives under Roadside.
            </span>
          </label>

          <label className={label}>
            Work type
            <select
              value={workType}
              onChange={(e) => setWorkType(e.target.value)}
              className={select}
            >
              <option value="REPAIR">Repair</option>
              <option value="MAINTENANCE">Maintenance</option>
              <option value="PROJECT">Project</option>
            </select>
          </label>

          <label className={`${label} md:col-span-2`}>
            Customer concern
            <textarea
              value={concern}
              onChange={(e) => setConcern(e.target.value)}
              maxLength={2000}
              className="min-h-20 rounded-md border border-input bg-background p-3 text-sm"
              placeholder="What does the customer need? (optional — you can add this after talking to them)"
            />
          </label>

          <div className="flex gap-2 md:col-span-2">
            <Button type="submit" disabled={pending || !customerId || !locationId}>
              {pending ? "Creating…" : "Create work order"}
            </Button>
            <Button type="button" variant="outline" onClick={collapse} disabled={pending}>
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
