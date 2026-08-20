"use client";

import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

/**
 * Add a vehicle/asset from the customer's profile — where the thought
 * starts. Year/make/model build the display name; VIN and plate capture
 * identity; mileage seeds the service history.
 */
export function AddAssetForm({
  customerId,
  onSuccess,
}: {
  customerId: string;
  onSuccess?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [plate, setPlate] = useState("");
  const [vin, setVin] = useState("");
  const [mileage, setMileage] = useState("");
  const [color, setColor] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label = "grid gap-1 text-sm font-medium";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const yearNum = parseInt(year, 10);
    const displayName = [year, make, model].filter(Boolean).join(" ").trim() || "Unnamed vehicle";
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId,
          displayName,
          category: "automobile",
          ...(make ? { manufacturer: make } : {}),
          ...(model ? { model } : {}),
          ...(Number.isFinite(yearNum) && yearNum >= 1900 ? { modelYear: yearNum } : {}),
          ...(vin.trim() ? { serialNumber: vin.trim() } : {}),
          description:
            [color.trim(), mileage.trim() ? `${parseInt(mileage, 10).toLocaleString()} mi` : ""]
              .filter(Boolean)
              .join(", ") || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const messages: Record<string, string> = {
          customer_not_found: "That customer no longer exists.",
          invalid_body: "Check the year and mileage.",
        };
        throw new Error(messages[body.error ?? ""] ?? "Could not add the vehicle.");
      }
      // Best-effort profile enrichment (plate/VIN/mileage) after creation.
      const created = await res.json();
      const assetId = created?.asset?.id;
      if (assetId && (plate.trim() || vin.trim() || mileage.trim())) {
        await fetch(`/api/assets/${assetId}/profile`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(plate.trim() ? { licensePlate: plate.trim() } : {}),
            ...(vin.trim() ? { vin: vin.trim() } : {}),
            ...(mileage.trim() ? { lastKnownMileage: parseInt(mileage, 10) } : {}),
          }),
        }).catch(() => undefined);
      }
      setOpen(false);
      setYear("");
      setMake("");
      setModel("");
      setPlate("");
      setVin("");
      setMileage("");
      setColor("");
      if (onSuccess) onSuccess();
      else window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add the vehicle.");
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Add vehicle
      </Button>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">New vehicle</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-3 md:grid-cols-4">
          {error ? (
            <Alert variant="destructive" className="md:col-span-4">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <label className={label}>
            Year
            <Input
              inputMode="numeric"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              placeholder="2021"
              disabled={pending}
            />
          </label>
          <label className={label}>
            Make *
            <Input
              value={make}
              onChange={(e) => setMake(e.target.value)}
              placeholder="Honda"
              required
              disabled={pending}
            />
          </label>
          <label className={label}>
            Model
            <Input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="Civic"
              disabled={pending}
            />
          </label>
          <label className={label}>
            Color
            <Input
              value={color}
              onChange={(e) => setColor(e.target.value)}
              placeholder="Blue"
              disabled={pending}
            />
          </label>
          <label className={label}>
            License plate
            <Input
              value={plate}
              onChange={(e) => setPlate(e.target.value)}
              placeholder="ABC-1234"
              disabled={pending}
            />
          </label>
          <label className={`${label} md:col-span-2`}>
            VIN
            <Input
              value={vin}
              onChange={(e) => setVin(e.target.value.toUpperCase())}
              placeholder="17-character VIN"
              maxLength={17}
              disabled={pending}
            />
          </label>
          <label className={label}>
            Mileage
            <Input
              inputMode="numeric"
              value={mileage}
              onChange={(e) => setMileage(e.target.value)}
              placeholder="45000"
              disabled={pending}
            />
          </label>
          <div className="flex items-end gap-2 md:col-span-4">
            <Button type="submit" disabled={pending || make.trim().length < 1}>
              {pending ? "Saving…" : "Add vehicle"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
