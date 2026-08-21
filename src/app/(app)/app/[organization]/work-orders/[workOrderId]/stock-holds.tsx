"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDateTime } from "@/i18n/formatters";

type HoldItem = { id: string; label: string; onHand: number; available: number };

type Reservation = {
  id: string;
  quantity: number;
  status: "ACTIVE" | "RELEASED" | "CONSUMED";
  note: string | null;
  createdAt: string;
  itemName: string;
  createdByName: string | null;
};

/**
 * Stock holds for one work order: while an estimate is pending the shop can
 * hold parts (reducing availability without touching on-hand); declines,
 * superseded revisions, and cancellation release holds automatically, and
 * issuing converts them into consumption.
 */
export function StockHolds({ workOrderId, canWrite }: { workOrderId: string; canWrite: boolean }) {
  const [items, setItems] = useState<HoldItem[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [itemId, setItemId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/work-orders/${workOrderId}/reservations`);
    if (res.ok) {
      const data = await res.json();
      setItems(data.items ?? []);
      setReservations(data.reservations ?? []);
    }
  }, [workOrderId]);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        const res = await fetch(`/api/work-orders/${workOrderId}/reservations`);
        if (res.ok && !cancelled) {
          const data = await res.json();
          setItems(data.items ?? []);
          setReservations(data.reservations ?? []);
        }
      })();
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [workOrderId]);

  const selected = useMemo(() => items.find((item) => item.id === itemId), [items, itemId]);
  const active = reservations.filter((reservation) => reservation.status === "ACTIVE");

  async function hold(e: React.FormEvent) {
    e.preventDefault();
    const qty = Number(quantity);
    if (!itemId || !Number.isInteger(qty) || qty < 1) return;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/work-orders/${workOrderId}/reservations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId,
          quantity: qty,
          ...(note.trim() ? { note: note.trim() } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const messages: Record<string, string> = {
          insufficient_stock: "Not enough unheld stock for that quantity.",
          work_order_not_open: "This work order is closed or cancelled.",
          item_not_found: "That part isn't in your inventory.",
        };
        throw new Error(messages[data.error] ?? "Could not hold the part.");
      }
      setQuantity("1");
      setNote("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not hold the part.");
    } finally {
      setPending(false);
    }
  }

  async function release(reservationId: string) {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/work-orders/${workOrderId}/reservations`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "release", reservationId }),
      });
      if (!res.ok) throw new Error("Could not release the hold.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not release the hold.");
    } finally {
      setPending(false);
    }
  }

  async function issueAll() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/work-orders/${workOrderId}/reservations`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "issue-all" }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data.error === "insufficient_stock"
            ? "On-hand dropped below a hold — adjust the count first."
            : "Could not issue the held parts.",
        );
      }
      setNotice(`Issued ${data.issued} hold${data.issued === 1 ? "" : "s"} to the job.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not issue the held parts.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {notice ? (
        <Alert>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}

      {canWrite ? (
        <form className="flex flex-wrap items-end gap-2" onSubmit={hold}>
          <label className="flex min-w-56 flex-1 flex-col gap-1">
            <span className="text-xs text-muted-foreground">Part to hold</span>
            <select
              value={itemId}
              onChange={(e) => setItemId(e.target.value)}
              disabled={pending}
              className="h-[var(--control-height)] rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="">Pick a stocked part…</option>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label} ({item.available} available)
                </option>
              ))}
            </select>
          </label>
          <label className="flex w-20 flex-col gap-1">
            <span className="text-xs text-muted-foreground">Qty</span>
            <Input
              type="number"
              min={1}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              disabled={pending}
            />
          </label>
          <label className="flex min-w-40 flex-1 flex-col gap-1">
            <span className="text-xs text-muted-foreground">Note (optional)</span>
            <Input
              placeholder="Held for pending estimate"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={pending}
            />
          </label>
          <Button type="submit" size="sm" disabled={pending || !itemId}>
            Hold
          </Button>
        </form>
      ) : null}
      {selected ? (
        <p className="text-xs text-muted-foreground">
          {selected.label}: {selected.onHand} on hand · {selected.available} available after holds.
        </p>
      ) : null}

      {reservations.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No stock held for this work order. Holds keep parts available while an estimate is pending
          — they release automatically if the estimate is declined or superseded.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {reservations.map((reservation) => (
            <li
              key={reservation.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {reservation.itemName} ×{reservation.quantity}
                  {reservation.status === "ACTIVE" ? (
                    <Badge variant="default" className="ml-2 text-[10px]">
                      held
                    </Badge>
                  ) : reservation.status === "CONSUMED" ? (
                    <Badge variant="outline" className="ml-2 text-[10px]">
                      issued
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="ml-2 text-[10px]">
                      released
                    </Badge>
                  )}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {[
                    reservation.note,
                    reservation.createdByName,
                    formatDateTime(new Date(reservation.createdAt), "UTC", "en-US"),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              {canWrite && reservation.status === "ACTIVE" ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => void release(reservation.id)}
                >
                  Release
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canWrite && active.length > 0 ? (
        <div className="flex items-center gap-2">
          <Button size="sm" disabled={pending} onClick={() => void issueAll()}>
            Issue held parts to this job
          </Button>
          <span className="text-xs text-muted-foreground">
            Takes the parts off the shelf and records the consumption.
          </span>
        </div>
      ) : null}
    </div>
  );
}
