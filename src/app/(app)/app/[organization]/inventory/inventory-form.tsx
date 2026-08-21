"use client";

import { useEffect, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { parseMoneyInput } from "@/i18n/money-input";

type CategoryOption = { id: string; name: string };
type LocationOption = { id: string; name: string };

const CONDITIONS = [
  ["new", "New"],
  ["used", "Used"],
  ["refurb", "Refurbished"],
] as const;

const COMMON_UOM = [
  "each",
  "quart",
  "gallon",
  "5L",
  "pail",
  "drum",
  "box",
  "pair",
  "set",
  "meter",
  "foot",
];

/** Adds a stocked part — every box labeled, identity through supply flags. */
export function InventoryForm({
  locations,
  canManageCategories,
}: {
  locations: ReadonlyArray<LocationOption>;
  canManageCategories: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [partNumber, setPartNumber] = useState("");
  const [oeNumber, setOeNumber] = useState("");
  const [brand, setBrand] = useState("");
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [newCategory, setNewCategory] = useState("");
  const [locationId, setLocationId] = useState("");
  const [condition, setCondition] = useState("new");
  const [hasCore, setHasCore] = useState(false);
  const [coreValue, setCoreValue] = useState("");
  const [consumable, setConsumable] = useState(false);
  const [nonSaleable, setNonSaleable] = useState(false);
  const [uomGroup, setUomGroup] = useState("");
  const [unitOfMeasure, setUnitOfMeasure] = useState("");
  const [uomFactor, setUomFactor] = useState("");
  const [quantity, setQuantity] = useState("0");
  const [reorderPoint, setReorderPoint] = useState("0");
  const [unitCost, setUnitCost] = useState("0");
  const [bin, setBin] = useState("");
  const [notes, setNotes] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      void (async () => {
        try {
          const res = await fetch("/api/inventory/categories");
          if (res.ok && !cancelled) {
            const data = await res.json();
            if (!cancelled) setCategories(data.categories ?? []);
          }
        } catch {
          /* categories are optional */
        }
      })();
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open]);

  async function createCategory() {
    if (newCategory.trim().length < 2) return;
    const res = await fetch("/api/inventory/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create", name: newCategory.trim() }),
    });
    if (res.ok) {
      setNewCategory("");
      const refresh = await fetch("/api/inventory/categories");
      if (refresh.ok) {
        const data = await refresh.json();
        setCategories(data.categories ?? []);
        const created = (data.categories ?? []).find(
          (category: CategoryOption) =>
            category.name.toLowerCase() === newCategory.trim().toLowerCase(),
        );
        if (created) setCategoryId(created.id);
      }
    }
  }

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
          ...(locationId ? { locationId } : {}),
          ...(oeNumber.trim() ? { oeNumber: oeNumber.trim() } : {}),
          ...(brand.trim() ? { brand: brand.trim() } : {}),
          ...(categoryId ? { categoryId } : {}),
          ...(uomGroup.trim() ? { uomGroup: uomGroup.trim() } : {}),
          ...(unitOfMeasure.trim() ? { unitOfMeasure: unitOfMeasure.trim() } : {}),
          ...(uomFactor.trim()
            ? { uomFactorMilli: Math.round(Number(uomFactor) * 1000) || undefined }
            : {}),
          condition,
          hasCore,
          ...(hasCore && coreValue.trim()
            ? { coreValueMinor: parseMoneyInput(coreValue) ?? 0 }
            : {}),
          consumable,
          nonSaleable,
          quantityOnHand: Number(quantity) || 0,
          reorderPoint: Number(reorderPoint) || 0,
          unitCostMinor: parseMoneyInput(unitCost) ?? 0,
          ...(bin.trim() ? { binLocation: bin.trim() } : {}),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const messages: Record<string, string> = {
          duplicate_part_number: "That part number is already stocked at this location.",
          invalid_quantity: "Quantities and costs must be zero or more.",
          location_denied: "You don't manage stock at that location.",
        };
        throw new Error(messages[data.error ?? ""] ?? "Could not add the part.");
      }
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add the part.");
    } finally {
      setPending(false);
    }
  }

  const label = "grid gap-1 text-sm font-medium";
  const input =
    "h-[var(--control-height)] rounded-md border border-input bg-background px-3 text-sm";

  if (!open) {
    return <Button onClick={() => setOpen(true)}>Add part</Button>;
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <form onSubmit={submit} className="grid w-full max-w-3xl gap-3">
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <div className="grid gap-3 md:grid-cols-3">
            <label className={label}>
              Part number *
              <Input
                value={partNumber}
                onChange={(e) => setPartNumber(e.target.value)}
                placeholder="Your stock number"
                required
              />
            </label>
            <label className={label}>
              OE / interchange number
              <Input
                value={oeNumber}
                onChange={(e) => setOeNumber(e.target.value)}
                placeholder="OE-44100 — links substitutes"
              />
            </label>
            <label className={label}>
              Brand
              <Input
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                placeholder="Aisin, Bosch, Denso…"
              />
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <label className={`${label} md:col-span-2`}>
              Description *
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Brake master cylinder, front"
                required
              />
            </label>
            <label className={label}>
              Category
              <div className="flex gap-1">
                <select
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  className={input}
                >
                  <option value="">Uncategorized</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
                {canManageCategories ? (
                  <Input
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value)}
                    placeholder="New…"
                    className="w-24"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void createCategory();
                      }
                    }}

                    aria-label="New…"
                  />
                ) : null}
              </div>
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <label className={label}>
              Stocked at
              <select
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                className={input}
              >
                <option value="">All locations (shared)</option>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={label}>
              Condition
              <select
                value={condition}
                onChange={(e) => setCondition(e.target.value)}
                className={input}
              >
                {CONDITIONS.map(([value, text]) => (
                  <option key={value} value={value}>
                    {text}
                  </option>
                ))}
              </select>
            </label>
            <label className={label}>
              Unit of measure
              <input
                list="uom-list"
                value={unitOfMeasure}
                onChange={(e) => setUnitOfMeasure(e.target.value)}
                placeholder="each, quart, gallon…"
                className={input}
              />
              <datalist id="uom-list">
                {COMMON_UOM.map((unit) => (
                  <option key={unit} value={unit} />
                ))}
              </datalist>
            </label>
            <label className={label}>
              Units per group base
              <Input
                inputMode="decimal"
                value={uomFactor}
                onChange={(e) => setUomFactor(e.target.value)}
                placeholder="quart=1, gallon=4"
              />
            </label>
          </div>
          {unitOfMeasure.trim() && !uomGroup.trim() ? (
            <label className={`${label} md:max-w-xs`}>
              Unit group (for grouping)
              <Input
                value={uomGroup}
                onChange={(e) => setUomGroup(e.target.value)}
                placeholder="volume, each, length"
              />
            </label>
          ) : null}

          <div className="grid gap-3 md:grid-cols-4">
            <label className={label}>
              On hand
              <Input
                type="number"
                min={0}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </label>
            <label className={label}>
              Reorder at
              <Input
                type="number"
                min={0}
                value={reorderPoint}
                onChange={(e) => setReorderPoint(e.target.value)}
              />
            </label>
            <label className={label}>
              Unit cost
              <Input
                inputMode="decimal"
                value={unitCost}
                onChange={(e) => setUnitCost(e.target.value)}
                placeholder="12.50"
              />
            </label>
            <label className={label}>
              Bin location
              <Input value={bin} onChange={(e) => setBin(e.target.value)} placeholder="A-12" />
            </label>
          </div>

          <div className="flex flex-wrap gap-4 border-t border-border pt-3 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={hasCore}
                onChange={(e) => setHasCore(e.target.checked)}
              />
              Has core charge
            </label>
            {hasCore ? (
              <label className="flex items-center gap-2">
                Core value
                <Input
                  inputMode="decimal"
                  value={coreValue}
                  onChange={(e) => setCoreValue(e.target.value)}
                  placeholder="30.00"
                  className="h-8 w-24"
                />
              </label>
            ) : null}
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={consumable}
                onChange={(e) => setConsumable(e.target.checked)}
              />
              Consumable supply
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={nonSaleable}
                onChange={(e) => setNonSaleable(e.target.checked)}
              />
              Non-saleable
            </label>
          </div>

          <label className={label}>
            Notes
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Fits 2019–2024 Civic 1.5T; verify bore before ordering…"
            />
          </label>

          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Add to stock"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
