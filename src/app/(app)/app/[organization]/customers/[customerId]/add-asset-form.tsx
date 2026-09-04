"use client";

import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type DecodedVehicle = {
  year: number;
  make: string;
  model: string;
  trim?: string;
  engine?: string;
  transmission?: string;
  drivetrain?: string;
  bodyStyle?: string;
  fuelType?: string;
};

/**
 * Add a vehicle/asset from the customer's profile — where the thought
 * starts. Year/make/model build the display name; VIN and plate capture
 * identity; mileage seeds the service history. A VIN can be decoded to
 * pre-fill the details — always a shortcut, never a requirement.
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
  const [decoded, setDecoded] = useState<DecodedVehicle | null>(null);
  const [decoding, setDecoding] = useState(false);
  const [decodeError, setDecodeError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label = "grid gap-1 text-sm font-medium";

  async function decodeVin() {
    setDecoding(true);
    setDecodeError(null);
    setDecoded(null);
    try {
      const res = await fetch("/api/assets/vin-decode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vin: vin.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const messages: Record<string, string> = {
          invalid_vin:
            body.reason === "length"
              ? "VIN must be exactly 17 characters."
              : body.reason === "characters"
                ? "VINs never contain the letters I, O, or Q."
                : "The VIN check digit doesn't match — double-check the number.",
          no_match: "No vehicle found for that VIN. Enter the details manually.",
          decode_unavailable: "VIN decoding isn't available right now. Enter details manually.",
          permission_denied: "You don't have permission to add vehicles.",
        };
        throw new Error(messages[body.error ?? ""] ?? "Could not decode that VIN.");
      }
      const vehicle = body.vehicle as DecodedVehicle;
      setDecoded(vehicle);
      setYear(String(vehicle.year));
      setMake(vehicle.make);
      setModel(vehicle.model);
    } catch (e) {
      setDecodeError(e instanceof Error ? e.message : "Could not decode that VIN.");
    } finally {
      setDecoding(false);
    }
  }

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
      // Best-effort profile enrichment (plate/VIN/mileage + decoded details) after creation.
      const created = await res.json();
      const assetId = created?.asset?.id;
      if (assetId && (plate.trim() || vin.trim() || mileage.trim() || decoded)) {
        await fetch(`/api/assets/${assetId}/profile`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(plate.trim() ? { licensePlate: plate.trim() } : {}),
            ...(vin.trim() ? { vin: vin.trim() } : {}),
            ...(mileage.trim() ? { lastKnownMileage: parseInt(mileage, 10) } : {}),
            ...(decoded?.trim ? { trim: decoded.trim } : {}),
            ...(decoded?.engine ? { engine: decoded.engine } : {}),
            ...(decoded?.transmission ? { transmission: decoded.transmission } : {}),
            ...(decoded?.drivetrain ? { drivetrain: decoded.drivetrain } : {}),
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
      setDecoded(null);
      setDecodeError(null);
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
            <span className="flex gap-2">
              <Input
                value={vin}
                onChange={(e) => {
                  setVin(e.target.value.toUpperCase());
                  setDecoded(null);
                  setDecodeError(null);
                }}
                placeholder="17-character VIN"
                maxLength={17}
                disabled={pending}
              />
              <Button
                type="button"
                variant="outline"
                className="shrink-0"
                onClick={() => void decodeVin()}
                disabled={pending || decoding || vin.trim().length !== 17}
              >
                {decoding ? "Decoding…" : "Decode"}
              </Button>
            </span>
            {decoded ? (
              <span className="text-xs font-normal text-muted-foreground">
                Decoded:{" "}
                {[decoded.year, decoded.make, decoded.model, decoded.trim, decoded.bodyStyle]
                  .filter(Boolean)
                  .join(" ")}
                {decoded.engine ? ` · ${decoded.engine}` : ""}
              </span>
            ) : null}
            {decodeError ? (
              <span className="text-xs font-normal text-destructive">{decodeError}</span>
            ) : null}
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
