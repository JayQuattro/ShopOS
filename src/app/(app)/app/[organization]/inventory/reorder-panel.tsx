"use client";

import { useEffect, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney } from "@/i18n/formatters";

type Suggestion = {
  itemId: string;
  partNumber: string;
  name: string;
  quantityOnHand: number;
  reorderPoint: number;
  unitCostMinor: string;
  currency: string;
  suggestedQuantity: number;
  supplierId: string | null;
  supplierName: string | null;
};

/**
 * Restock run: low-stock items with suggested quantities, one click drafts a
 * REQUESTED part order (supplier inferred from the item's purchase history).
 */
export function ReorderPanel({ canWrite }: { canWrite: boolean }) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [workOrderId, setWorkOrderId] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch("/api/inventory/reorder");
          if (res.ok && !cancelled) {
            const data = await res.json();
            setSuggestions(data.suggestions ?? []);
            setSelected(new Set((data.suggestions ?? []).map((s: Suggestion) => s.itemId)));
          }
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  function toggle(itemId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  }

  async function createOrder() {
    const ids = [...selected];
    if (ids.length === 0 || !workOrderId.trim()) {
      setError("Pick at least one part and the restock work order to order against.");
      return;
    }
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/inventory/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workOrderId: workOrderId.trim(), itemIds: ids }),
      });
      const data = await res.json();
      if (!res.ok) {
        const messages: Record<string, string> = {
          supplier_not_found:
            "No supplier found for these parts yet — order them once from a work order so history can learn it.",
          work_order_not_found: "That work order doesn't exist in this organization.",
          item_not_found: "One of the selected items no longer exists.",
        };
        throw new Error(messages[data.error] ?? "Could not create the restock order.");
      }
      setNotice(`Restock order created — find it on the work order's Parts panel.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the restock order.");
    } finally {
      setPending(false);
    }
  }

  if (loading || suggestions.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Restock suggestions</CardTitle>
        <CardDescription>
          Items at or below their reorder point, with a suggested order quantity. Drafts a part
          order on a work order you pick.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {notice ? (
          <Alert variant="info">
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        ) : null}
        <ul className="flex flex-col divide-y divide-border">
          {suggestions.map((suggestion) => (
            <li key={suggestion.itemId} className="flex items-center justify-between gap-2 py-2">
              <label className="flex flex-1 items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={selected.has(suggestion.itemId)}
                  onChange={() => toggle(suggestion.itemId)}
                  disabled={pending || !canWrite}
                  className="size-4 rounded border-input"
                />
                <span className="flex-1">
                  <span className="font-medium">{suggestion.name}</span>{" "}
                  <span className="font-mono text-xs text-muted-foreground">
                    {suggestion.partNumber}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {suggestion.quantityOnHand} on hand · reorder at {suggestion.reorderPoint}
                    {suggestion.supplierName ? ` · usually from ${suggestion.supplierName}` : ""}
                  </span>
                </span>
              </label>
              <span className="text-sm">
                order{" "}
                <strong className="font-mono tabular-nums">{suggestion.suggestedQuantity}</strong> ·{" "}
                <span className="font-mono tabular-nums text-muted-foreground">
                  {formatMoney(
                    Number(suggestion.unitCostMinor) * suggestion.suggestedQuantity,
                    suggestion.currency,
                    "en-US",
                  )}
                </span>
              </span>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-sm font-medium">
            Restock against work order
            <input
              value={workOrderId}
              onChange={(e) => setWorkOrderId(e.target.value)}
              placeholder="Paste a work-order id, or use a restock RO"
              disabled={pending || !canWrite}
              className="h-[var(--control-height)] w-80 rounded-md border border-input bg-background px-3 text-sm"
            />
          </label>
          <Button
            onClick={() => void createOrder()}
            disabled={pending || !canWrite || selected.size === 0}
          >
            {pending ? "Creating…" : `Order ${selected.size} item${selected.size === 1 ? "" : "s"}`}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
