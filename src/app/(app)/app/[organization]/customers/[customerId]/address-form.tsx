"use client";

import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  addressShapeFor,
  postalHint,
  SUPPORTED_ADDRESS_COUNTRIES,
  type AddressField,
} from "@/i18n/address-formats";

type FieldName = AddressField["name"];

/** Adds a customer address, laid out the way its country writes them. */
export function AddressForm({ customerId }: { customerId: string }) {
  const [open, setOpen] = useState(false);
  const [country, setCountry] = useState("US");
  const [label, setLabel] = useState("");
  const [values, setValues] = useState<Record<FieldName, string>>({
    line1: "",
    line2: "",
    city: "",
    stateProvince: "",
    postalCode: "",
  });
  const [isPrimary, setIsPrimary] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shape = addressShapeFor(country);
  const postalAdvice = postalHint(country, values.postalCode);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const requiredMet = shape.fields
      .filter((field) => field.required)
      .every((field) => values[field.name].trim().length > 0);
    if (!label.trim() || !requiredMet) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/customers/${customerId}/addresses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label,
          line1: values.line1,
          city: values.city,
          ...(values.line2 ? { line2: values.line2 } : {}),
          ...(values.stateProvince ? { stateProvince: values.stateProvince } : {}),
          ...(values.postalCode ? { postalCode: values.postalCode } : {}),
          country,
          isPrimary,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed");
      }
      setOpen(false);
      setLabel("");
      setValues({ line1: "", line2: "", city: "", stateProvince: "", postalCode: "" });
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

  const allRequiredMet = shape.fields
    .filter((field) => field.required)
    .every((field) => values[field.name].trim().length > 0);

  // Wide fields (street lines) go full width; the rest pair up in rows.
  const rows: AddressField[][] = [];
  for (const field of shape.fields) {
    const lastRow = rows[rows.length - 1];
    const isWide = field.name === "line1" || field.name === "line2";
    if (lastRow && lastRow.length === 1 && !isWide) {
      lastRow.push(field);
    } else {
      rows.push([field]);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid w-full max-w-md gap-2">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <label className="grid gap-1 text-sm font-medium">
        Label
        <Input
          placeholder="Billing / Home / Site *"
          required
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          disabled={pending}
        />
      </label>
      <label className="grid gap-1 text-sm font-medium">
        Country
        <select
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          disabled={pending}
          className="h-[var(--control-height)] rounded-md border border-input bg-background px-3 text-sm"
        >
          {SUPPORTED_ADDRESS_COUNTRIES.map((entry) => (
            <option key={entry.code} value={entry.code}>
              {entry.label}
            </option>
          ))}
        </select>
      </label>
      {rows.map((row, index) => (
        <div key={index} className={row.length > 1 ? "flex gap-2" : undefined}>
          {row.map((field) => (
            <label key={field.name} className="grid flex-1 gap-1 text-sm font-medium">
              {field.label}
              {field.required ? " *" : ""}
              <Input
                placeholder={field.placeholder ?? ""}
                required={field.required}
                value={values[field.name]}
                onChange={(e) => setValues((prev) => ({ ...prev, [field.name]: e.target.value }))}
                disabled={pending}
              />
            </label>
          ))}
        </div>
      ))}
      {postalAdvice ? (
        <p className="text-xs text-muted-foreground">
          Postcode looks unusual for this country — expected {postalAdvice}. You can still save.
        </p>
      ) : null}
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={isPrimary}
          onChange={(e) => setIsPrimary(e.target.checked)}
        />
        Primary address
      </label>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending || !label.trim() || !allRequiredMet}>
          Save
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setOpen(false)}
          disabled={pending}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
