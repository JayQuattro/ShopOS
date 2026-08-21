"use client";

import { useEffect, useMemo, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Option = { id: string; displayName: string };

const DRAFT_KEY = "shopos-wo-create-draft";

type WoDraft = Readonly<{
  customerId: string;
  assetId: string;
  locationId: string;
  workType: string;
  concern: string;
}>;

/**
 * A refresh while the form is open should never lose typed work. The draft
 * lives in sessionStorage (per tab), restores on reopen, and clears only on
 * successful create — being interrupted is a normal day at the counter.
 */
function readDraft(): Partial<WoDraft> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.sessionStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as Partial<WoDraft>) : {};
  } catch {
    return {};
  }
}

function clearDraft() {
  try {
    window.sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // Private browsing; nothing to clear.
  }
}

/**
 * New work order — wide, labeled, and scoped: the vehicle list follows the
 * chosen customer (never anyone else's), a vehicle can be added for the
 * customer right here (new customer, first visit is a common flow), concern
 * is optional, and the draft survives a refresh.
 */
export function WorkOrderCreateForm({
  customers,
  assets,
  locations,
  startOpen = false,
  preselectedCustomerId,
  preselectedAssetId,
}: {
  customers: ReadonlyArray<Option>;
  assets: ReadonlyArray<Option & { customerId: string }>;
  locations: ReadonlyArray<{ id: string; displayName: string }>;
  startOpen?: boolean;
  /** Deep-link prefill (e.g. "new work order for this customer"); ignored when unknown. */
  preselectedCustomerId?: string | undefined;
  preselectedAssetId?: string | undefined;
}) {
  const draft = useMemo(() => readDraft(), []);
  const preselectedCustomerValid = customers.some(
    (customer) => customer.id === preselectedCustomerId,
  );
  const draftCustomerValid = customers.some((customer) => customer.id === draft.customerId);
  const draftLocationValid = locations.some((location) => location.id === draft.locationId);

  const [open, setOpen] = useState(startOpen);
  const [customerId, setCustomerId] = useState(
    preselectedCustomerValid
      ? (preselectedCustomerId ?? "")
      : draftCustomerValid
        ? (draft.customerId ?? "")
        : "",
  );
  const [assetId, setAssetId] = useState(preselectedAssetId ?? draft.assetId ?? "");
  const [locationId, setLocationId] = useState(
    draftLocationValid ? (draft.locationId ?? "") : (locations[0]?.id ?? ""),
  );
  const [workType, setWorkType] = useState(draft.workType ?? "REPAIR");
  const [concern, setConcern] = useState(draft.concern ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Inline "add a vehicle for this customer" — new customer, first visit.
  const [assetOptions, setAssetOptions] =
    useState<ReadonlyArray<Option & { customerId: string }>>(assets);
  const [vehicleFormOpen, setVehicleFormOpen] = useState(false);
  const [vYear, setVYear] = useState("");
  const [vMake, setVMake] = useState("");
  const [vModel, setVModel] = useState("");
  const [vPlate, setVPlate] = useState("");
  const [vVin, setVVin] = useState("");
  const [vMileage, setVMileage] = useState("");
  const [vPending, setVPending] = useState(false);
  const [vError, setVError] = useState<string | null>(null);
  const [vAdded, setVAdded] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    try {
      window.sessionStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({ customerId, assetId, locationId, workType, concern } satisfies WoDraft),
      );
    } catch {
      // Private browsing; the form still works, it just won't survive a refresh.
    }
  }, [open, customerId, assetId, locationId, workType, concern]);

  // Only the chosen customer's vehicles — assignment is scoped at the UI
  // boundary and re-validated server-side.
  const customerAssets = useMemo(
    () => assetOptions.filter((asset) => !customerId || asset.customerId === customerId),
    [assetOptions, customerId],
  );

  // An asset picked for a previous customer is simply invalid now —
  // derived, not synced: it won't submit and the select shows the placeholder.
  const effectiveAssetId = customerAssets.some((asset) => asset.id === assetId) ? assetId : "";

  function requestAddVehicle() {
    if (!customerId || vMake.trim().length < 1) return;
    void addVehicle();
  }

  function vehicleFieldKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Enter") {
      // Inside the work-order form — Enter must add the vehicle, not submit the RO.
      event.preventDefault();
      requestAddVehicle();
    }
  }

  async function addVehicle() {
    if (!customerId || vMake.trim().length < 1) return;
    setVPending(true);
    setVError(null);
    const yearNum = parseInt(vYear, 10);
    const displayName =
      [vYear, vMake, vModel].filter(Boolean).join(" ").trim() || "Unnamed vehicle";
    try {
      const res = await fetch("/api/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId,
          displayName,
          category: "automobile",
          ...(vMake ? { manufacturer: vMake } : {}),
          ...(vModel ? { model: vModel } : {}),
          ...(Number.isFinite(yearNum) && yearNum >= 1900 ? { modelYear: yearNum } : {}),
          ...(vVin.trim() ? { serialNumber: vVin.trim() } : {}),
        }),
      });
      if (!res.ok) throw new Error("Could not add the vehicle.");
      const created = await res.json();
      const assetIdCreated: string | undefined = created?.asset?.id;
      if (!assetIdCreated) throw new Error("Could not add the vehicle.");
      // Best-effort profile enrichment (plate/VIN/mileage).
      if (vPlate.trim() || vVin.trim() || vMileage.trim()) {
        await fetch(`/api/assets/${assetIdCreated}/profile`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(vPlate.trim() ? { licensePlate: vPlate.trim() } : {}),
            ...(vVin.trim() ? { vin: vVin.trim() } : {}),
            ...(vMileage.trim() ? { lastKnownMileage: parseInt(vMileage, 10) } : {}),
          }),
        }).catch(() => undefined);
      }
      setAssetOptions((current) => [...current, { id: assetIdCreated, displayName, customerId }]);
      setAssetId(assetIdCreated);
      setVAdded(displayName);
      setVehicleFormOpen(false);
      setVYear("");
      setVMake("");
      setVModel("");
      setVPlate("");
      setVVin("");
      setVMileage("");
    } catch (e) {
      setVError(e instanceof Error ? e.message : "Could not add the vehicle.");
    } finally {
      setVPending(false);
    }
  }

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
      clearDraft();
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
              onChange={(e) => {
                setCustomerId(e.target.value);
                setVehicleFormOpen(false);
                setVAdded(null);
              }}
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

          <div className={`${label}`}>
            <span>
              Vehicle
              {vAdded ? (
                <span className="ml-2 text-xs font-normal text-success">
                  Added “{vAdded}” — selected below.
                </span>
              ) : null}
            </span>
            <select
              value={effectiveAssetId}
              aria-label="Vehicle"
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
            {customerId && !vehicleFormOpen ? (
              <Button
                type="button"
                variant="link"
                className="h-auto justify-start p-0 text-xs"
                onClick={() => setVehicleFormOpen(true)}
                disabled={vPending}
              >
                + Add a vehicle for this customer
              </Button>
            ) : null}
          </div>

          {vehicleFormOpen && customerId ? (
            <div className="md:col-span-2">
              <div className="rounded-lg border border-border bg-muted/30 p-4">
                <div className="grid gap-3 md:grid-cols-3">
                  {vError ? (
                    <Alert variant="destructive" className="md:col-span-3">
                      <AlertDescription>{vError}</AlertDescription>
                    </Alert>
                  ) : null}
                  <label className={label}>
                    Year
                    <Input
                      inputMode="numeric"
                      value={vYear}
                      onChange={(e) => setVYear(e.target.value)}
                      onKeyDown={vehicleFieldKeyDown}
                      placeholder="2021"
                      disabled={vPending}
                    />
                  </label>
                  <label className={label}>
                    Make *
                    <Input
                      value={vMake}
                      onChange={(e) => setVMake(e.target.value)}
                      onKeyDown={vehicleFieldKeyDown}
                      placeholder="Honda"
                      required
                      disabled={vPending}
                    />
                  </label>
                  <label className={label}>
                    Model
                    <Input
                      value={vModel}
                      onChange={(e) => setVModel(e.target.value)}
                      onKeyDown={vehicleFieldKeyDown}
                      placeholder="Civic"
                      disabled={vPending}
                    />
                  </label>
                  <label className={label}>
                    License plate
                    <Input
                      value={vPlate}
                      onChange={(e) => setVPlate(e.target.value)}
                      onKeyDown={vehicleFieldKeyDown}
                      placeholder="ABC-1234"
                      disabled={vPending}
                    />
                  </label>
                  <label className={label}>
                    VIN
                    <Input
                      value={vVin}
                      onChange={(e) => setVVin(e.target.value.toUpperCase())}
                      onKeyDown={vehicleFieldKeyDown}
                      placeholder="17-character VIN"
                      maxLength={17}
                      disabled={vPending}
                    />
                  </label>
                  <label className={label}>
                    Mileage
                    <Input
                      inputMode="numeric"
                      value={vMileage}
                      onChange={(e) => setVMileage(e.target.value)}
                      onKeyDown={vehicleFieldKeyDown}
                      placeholder="45000"
                      disabled={vPending}
                    />
                  </label>
                  <div className="flex gap-2 md:col-span-3">
                    <Button
                      type="button"
                      size="sm"
                      onClick={requestAddVehicle}
                      disabled={vPending || vMake.trim().length < 1}
                    >
                      {vPending ? "Adding…" : "Add vehicle"}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setVehicleFormOpen(false)}
                      disabled={vPending}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

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
            <span className="self-center text-xs text-muted-foreground">
              Your entries stay saved if you leave and come back.
            </span>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
