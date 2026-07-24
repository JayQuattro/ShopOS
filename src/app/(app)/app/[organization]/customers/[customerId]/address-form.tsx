"use client";

import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function AddressForm({ customerId }: { customerId: string }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [line1, setLine1] = useState("");
  const [line2, setLine2] = useState("");
  const [city, setCity] = useState("");
  const [stateProvince, setStateProvince] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [isPrimary, setIsPrimary] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim() || !line1.trim() || !city.trim()) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/customers/${customerId}/addresses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label,
          line1,
          city,
          ...(line2 ? { line2 } : {}),
          ...(stateProvince ? { stateProvince } : {}),
          ...(postalCode ? { postalCode } : {}),
          isPrimary,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed");
      }
      setOpen(false);
      setLabel("");
      setLine1("");
      setLine2("");
      setCity("");
      setStateProvince("");
      setPostalCode("");
      setIsPrimary(false);
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Add address
      </Button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="grid w-full max-w-md gap-2">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <Input
        placeholder="Label (e.g. Billing) *"
        required
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        disabled={pending}
      />
      <Input
        placeholder="Address line 1 *"
        required
        value={line1}
        onChange={(e) => setLine1(e.target.value)}
        disabled={pending}
      />
      <Input
        placeholder="Address line 2"
        value={line2}
        onChange={(e) => setLine2(e.target.value)}
        disabled={pending}
      />
      <Input
        placeholder="City *"
        required
        value={city}
        onChange={(e) => setCity(e.target.value)}
        disabled={pending}
      />
      <div className="flex gap-2">
        <Input
          placeholder="State / Province"
          value={stateProvince}
          onChange={(e) => setStateProvince(e.target.value)}
          disabled={pending}
        />
        <Input
          placeholder="Postal code"
          value={postalCode}
          onChange={(e) => setPostalCode(e.target.value)}
          disabled={pending}
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={isPrimary}
          onChange={(e) => setIsPrimary(e.target.checked)}
        />
        Primary address
      </label>
      <div className="flex gap-2">
        <Button
          type="submit"
          size="sm"
          disabled={pending || !label.trim() || !line1.trim() || !city.trim()}
        >
          Save
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setOpen(false)}
          disabled={pending}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
