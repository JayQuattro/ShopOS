"use client";

import { useEffect, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/i18n/formatters";

import { StockHolds } from "./stock-holds";

type PartOrder = {
  id: string;
  status: "REQUESTED" | "ORDERED" | "RECEIVED" | "CANCELLED";
  source: "MANUAL" | "CONNECTOR";
  currency: string;
  trackingNumber: string | null;
  note: string | null;
  supplierName: string;
  orderedAt: string | null;
  totalCostMinor: string;
  lines: Array<{
    id: string;
    description: string;
    partNumber: string | null;
    quantity: number;
    receivedQuantity: number;
    unitCostMinor: string;
  }>;
};

type Supplier = { id: string; name: string; active: boolean };

type InventoryCandidate = {
  partNumber: string;
  name: string;
  quantity: number;
  unitCostMinor: string;
  currency: string;
};

type DraftLine = {
  description: string;
  partNumber: string;
  quantity: string;
  unitCostMinor: string;
};

const emptyLine: DraftLine = { description: "", partNumber: "", quantity: "1", unitCostMinor: "0" };

export function PartsPanel({ workOrderId, canWrite }: { workOrderId: string; canWrite: boolean }) {
  const [orders, setOrders] = useState<PartOrder[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [newSupplierName, setNewSupplierName] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([{ ...emptyLine }]);

  async function load() {
    const res = await fetch(`/api/work-orders/${workOrderId}/part-orders`);
    if (res.ok) {
      const data = await res.json();
      setOrders(data.orders ?? []);
      setSuppliers(data.suppliers ?? []);
    }
  }

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(`/api/work-orders/${workOrderId}/part-orders`);
          if (res.ok && !cancelled) {
            const data = await res.json();
            setOrders(data.orders ?? []);
            setSuppliers(data.suppliers ?? []);
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
  }, [workOrderId]);

  async function addSupplier() {
    if (newSupplierName.trim().length < 2) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/work-orders/${workOrderId}/part-orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create-supplier", name: newSupplierName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data.error === "duplicate_supplier_name"
            ? "That supplier already exists."
            : "Could not add the supplier.",
        );
      }
      setNewSupplierName("");
      setSupplierId(data.supplierId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add the supplier.");
    } finally {
      setPending(false);
    }
  }

  async function submitOrder(e: React.FormEvent) {
    e.preventDefault();
    const valid = lines.filter(
      (line) => line.description.trim().length >= 2 && Number(line.quantity) >= 1,
    );
    if (!supplierId || valid.length === 0) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/work-orders/${workOrderId}/part-orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create-order",
          supplierId,
          lines: valid.map((line) => ({
            description: line.description.trim(),
            ...(line.partNumber.trim() ? { partNumber: line.partNumber.trim() } : {}),
            quantity: Number(line.quantity),
            unitCostMinor: Math.round(Number(line.unitCostMinor || 0) * 100),
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok)
        throw new Error(
          data.error === "supplier_not_found"
            ? "Pick a supplier first."
            : "Could not create the parts order.",
        );
      setFormOpen(false);
      setLines([{ ...emptyLine }]);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the parts order.");
    } finally {
      setPending(false);
    }
  }

  async function orderAction(partOrderId: string, body: Record<string, unknown>) {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/work-orders/${workOrderId}/part-orders?partOrderId=${partOrderId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const messages: Record<string, string> = {
          invalid_transition: "That action isn't allowed for this order's status.",
          invalid_receive_quantity: "Cannot receive more than ordered.",
          line_not_in_order: "That line isn't part of this order.",
        };
        throw new Error(messages[data.error] ?? "Action failed.");
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed.");
    } finally {
      setPending(false);
    }
  }

  async function markOrderedFlow(partOrderId: string) {
    const tracking = window.prompt("Tracking number (optional)") ?? undefined;
    await orderAction(partOrderId, {
      action: "mark-ordered",
      ...(tracking ? { trackingNumber: tracking } : {}),
    });
  }

  async function receiveIntoStock(line: InventoryCandidate) {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/work-orders/${workOrderId}/receive-into-stock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          partNumber: line.partNumber,
          name: line.name,
          quantity: line.quantity,
          unitCostMinor: Number(line.unitCostMinor),
          currency: line.currency,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          data.error === "invalid_quantity"
            ? "Quantity must be at least 1."
            : "Could not receive into stock.",
        );
      }
      setNotice(`${line.name} received into inventory.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not receive into stock.");
    } finally {
      setPending(false);
    }
  }

  async function receiveFlow(order: PartOrder) {
    const bodyLines = order.lines
      .filter((line) => line.receivedQuantity < line.quantity)
      .map((line) => {
        const remaining = line.quantity - line.receivedQuantity;
        const input = window.prompt(
          `Received quantity for "${line.description}" (ordered ${line.quantity}, outstanding ${remaining})`,
          String(remaining),
        );
        if (input === null) return null;
        const quantity = Number(input);
        if (!Number.isInteger(quantity) || quantity < 1) return null;
        return { lineId: line.id, quantity };
      })
      .filter((line): line is { lineId: string; quantity: number } => line !== null);
    if (bodyLines.length === 0) return;
    await orderAction(order.id, { action: "receive", lines: bodyLines });
  }

  const currency = orders[0]?.currency ?? "USD";

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Parts</CardTitle>
        {canWrite ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setFormOpen((open) => !open)}
            disabled={pending}
          >
            Order parts
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {notice ? (
          <Alert variant="info">
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        ) : null}
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {formOpen && canWrite ? (
          <form
            onSubmit={submitOrder}
            className="flex flex-col gap-3 rounded-md border border-border p-3"
          >
            <div className="flex flex-wrap items-end gap-2">
              <label className="grid gap-1 text-sm font-medium">
                Supplier
                <select
                  value={supplierId}
                  onChange={(e) => setSupplierId(e.target.value)}
                  required
                  className="h-[var(--control-height)] rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="">Select supplier…</option>
                  {suppliers
                    .filter((supplier) => supplier.active)
                    .map((supplier) => (
                      <option key={supplier.id} value={supplier.id}>
                        {supplier.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="grid gap-1 text-sm font-medium">
                or add new
                <div className="flex gap-2">
                  <Input
                    value={newSupplierName}
                    onChange={(e) => setNewSupplierName(e.target.value)}
                    placeholder="Supplier name"
                    className="max-w-[12rem]"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={addSupplier}
                    disabled={pending || newSupplierName.trim().length < 2}
                  >
                    Add
                  </Button>
                </div>
              </label>
            </div>

            {lines.map((line, index) => (
              <div key={index} className="flex flex-wrap items-end gap-2">
                <Input
                  value={line.description}
                  onChange={(e) =>
                    setLines((prev) =>
                      prev.map((l, i) => (i === index ? { ...l, description: e.target.value } : l)),
                    )
                  }
                  placeholder="Part description"
                  className="max-w-xs"

                  aria-label="Part description"
                />
                <Input
                  value={line.partNumber}
                  onChange={(e) =>
                    setLines((prev) =>
                      prev.map((l, i) => (i === index ? { ...l, partNumber: e.target.value } : l)),
                    )
                  }
                  placeholder="Part #"
                  className="w-28"

                  aria-label="Part #"
                />
                <Input
                  type="number"
                  min={1}
                  aria-label="Quantity"
                  value={line.quantity}
                  onChange={(e) =>
                    setLines((prev) =>
                      prev.map((l, i) => (i === index ? { ...l, quantity: e.target.value } : l)),
                    )
                  }
                  className="w-16"
                />
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={line.unitCostMinor}
                  onChange={(e) =>
                    setLines((prev) =>
                      prev.map((l, i) =>
                        i === index ? { ...l, unitCostMinor: e.target.value } : l,
                      ),
                    )
                  }
                  placeholder="Cost"
                  className="w-24"

                  aria-label="Cost"
                />
                {lines.length > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setLines((prev) => prev.filter((_, i) => i !== index))}
                  >
                    Remove
                  </Button>
                ) : null}
              </div>
            ))}
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setLines((prev) => [...prev, { ...emptyLine }])}
              >
                Add line
              </Button>
              <Button type="submit" size="sm" disabled={pending || !supplierId}>
                Create parts order
              </Button>
            </div>
          </form>
        ) : null}

        <div className="rounded-md border border-border p-3">
          <p className="mb-2 text-sm font-semibold">Stock holds</p>
          <StockHolds workOrderId={workOrderId} canWrite={canWrite} />
        </div>

        <p className="text-sm font-semibold text-muted-foreground">Orders</p>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading parts orders…</p>
        ) : orders.length === 0 ? (
          <p className="text-sm text-muted-foreground">No parts ordered for this work order.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {orders.map((order) => (
              <li key={order.id} className="rounded-md border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{order.supplierName}</span>
                    <Badge
                      variant={
                        order.status === "RECEIVED"
                          ? "default"
                          : order.status === "CANCELLED"
                            ? "secondary"
                            : order.status === "ORDERED"
                              ? "outline"
                              : "secondary"
                      }
                    >
                      {order.status.toLowerCase()}
                    </Badge>
                    <span className="font-mono text-xs text-muted-foreground">
                      {formatMoney(Number(order.totalCostMinor), order.currency, "en-US")}
                    </span>
                    {order.trackingNumber ? (
                      <span className="text-xs text-muted-foreground">
                        · tracking {order.trackingNumber}
                      </span>
                    ) : null}
                  </div>
                  {canWrite ? (
                    <div className="flex gap-1">
                      {order.status === "REQUESTED" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pending}
                          onClick={() => void markOrderedFlow(order.id)}
                        >
                          Mark ordered
                        </Button>
                      ) : null}
                      {order.status === "ORDERED" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pending}
                          onClick={() => void receiveFlow(order)}
                        >
                          Receive
                        </Button>
                      ) : null}
                      {order.status === "REQUESTED" || order.status === "ORDERED" ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={pending}
                          onClick={() => void orderAction(order.id, { action: "cancel" })}
                        >
                          Cancel
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <ul className="mt-2 flex flex-col gap-1">
                  {order.lines.map((line) => (
                    <li key={line.id} className="flex items-center justify-between text-sm">
                      <span>
                        {line.description}
                        {line.partNumber ? (
                          <span className="ml-2 font-mono text-xs text-muted-foreground">
                            #{line.partNumber}
                          </span>
                        ) : null}
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="font-mono text-xs tabular-nums text-muted-foreground">
                          {line.receivedQuantity}/{line.quantity} ·{" "}
                          {formatMoney(Number(line.unitCostMinor), order.currency, "en-US")}
                        </span>
                        {canWrite && line.partNumber && line.receivedQuantity > 0 ? (
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() =>
                              void receiveIntoStock({
                                partNumber: line.partNumber!,
                                name: line.description,
                                quantity: line.receivedQuantity,
                                unitCostMinor: line.unitCostMinor,
                                currency: order.currency,
                              })
                            }
                            className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted"
                            title="Move received quantity into inventory"
                          >
                            → stock
                          </button>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
        {!loading && orders.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            Total parts cost:{" "}
            {formatMoney(
              orders
                .filter((order) => order.status !== "CANCELLED")
                .reduce((sum, order) => sum + Number(order.totalCostMinor), 0),
              currency,
              "en-US",
            )}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
