"use client";

import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Adds a stocked part: part number, name, opening quantity, reorder point, cost. */
export function InventoryForm() {
  const [open, setOpen] = useState(false);
  const [partNumber, setPartNumber] = useState("");
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState("0");
  const [reorderPoint, setReorderPoint] = useState("0");
  const [unitCost, setUnitCost] = useState("0");
  const [bin, setBin] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!partNumber.trim() || name.trim().length < 2) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          partNumber: partNumber.trim(),
          name: name.trim(),
          quantityOnHand: Number(quantity) || 0,
          reorderPoint: Number(reorderPoint) || 0,
          unitCostMinor: Math.round((Number(unitCost) || 0) * 100),
          ...(bin.trim() ? { binLocation: bin.trim() } : {}),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const messages: Record<string, string> = {
          duplicate_part_number: "That part number is already stocked.",
          invalid_quantity: "Quantities must be zero or more.",
        };
        throw new Error(messages[data.error] ?? "Could not add the part.");
      }
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add the part.");
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return <Button onClick={() => setOpen(true)}>Add part</Button>;
  }

  return (
    <form onSubmit={submit} className="grid w-full max-w-lg gap-3">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex gap-2">
        <Input
          value={partNumber}
          onChange={(e) => setPartNumber(e.target.value)}
          placeholder="Part number"
          required
        />
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          required
          className="max-w-[14rem]"
        />
      </div>
      <div className="flex gap-2">
        <Input
          type="number"
          min={0}
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          placeholder="On hand"
          className="w-24"
        />
        <Input
          type="number"
          min={0}
          value={reorderPoint}
          onChange={(e) => setReorderPoint(e.target.value)}
          placeholder="Reorder at"
          className="w-28"
        />
        <Input
          type="number"
          min={0}
          step="0.01"
          value={unitCost}
          onChange={(e) => setUnitCost(e.target.value)}
          placeholder="Unit cost"
          className="w-28"
        />
        <Input
          value={bin}
          onChange={(e) => setBin(e.target.value)}
          placeholder="Bin"
          className="w-24"
        />
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Add to stock"}
        </Button>
        <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
