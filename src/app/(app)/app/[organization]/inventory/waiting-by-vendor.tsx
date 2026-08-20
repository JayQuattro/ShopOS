"use client";

import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

type WaitingOrder = {
  orderId: string;
  status: string;
  purpose: string;
  orderedAt: string | null;
  trackingNumber: string | null;
  workOrderNumber: string | null;
  lines: Array<{
    description: string;
    partNumber: string | null;
    quantity: number;
    receivedQuantity: number;
  }>;
};

type WaitingGroup = {
  supplierName: string;
  orders: WaitingOrder[];
};

const PURPOSE_LABEL: Record<string, string> = {
  JOB: "job",
  REPLENISH: "stock",
  ALLOCATION: "allocated",
};

/** The vendor board: open orders per supplier, with confirm-then-receive-all. */
export function WaitingByVendor() {
  const [groups, setGroups] = useState<WaitingGroup[] | null>(null);
  const [confirmOrder, setConfirmOrder] = useState<WaitingOrder | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch("/api/parts/waiting");
    if (res.ok) {
      const data = await res.json();
      setGroups(data.groups ?? []);
    }
  }

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      void refresh();
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  async function receiveAll(order: WaitingOrder) {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/parts/orders/${order.orderId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "receive-all" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const messages: Record<string, string> = {
          invalid_transition: "Only ordered deliveries can be received.",
          nothing_to_receive: "Nothing left to receive on this order.",
          order_not_found: "This order no longer exists.",
        };
        throw new Error(messages[data.error ?? ""] ?? "Could not receive.");
      }
      setConfirmOrder(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not receive.");
    } finally {
      setPending(false);
    }
  }

  if (groups === null) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (groups.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nothing waiting on vendors — every order is received.
      </p>
    );
  }

  const outstanding = (order: WaitingOrder) =>
    order.lines.reduce((sum, line) => sum + Math.max(0, line.quantity - line.receivedQuantity), 0);

  return (
    <>
      {error ? <p className="mb-3 text-sm text-destructive">{error}</p> : null}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {groups.map((group) => (
          <Card key={group.supplierName}>
            <CardHeader>
              <CardTitle className="text-base">
                {group.supplierName}
                <Badge variant="secondary" className="ml-2 text-[10px]">
                  {group.orders.length} open
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {group.orders.map((order) => (
                <div key={order.orderId} className="rounded-lg border border-border p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge
                        variant={order.status === "ORDERED" ? "default" : "outline"}
                        className="text-[10px]"
                      >
                        {order.status === "ORDERED" ? "ordered" : "requested"}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        {PURPOSE_LABEL[order.purpose] ?? order.purpose}
                      </Badge>
                      {order.workOrderNumber ? (
                        <span className="font-mono text-xs text-muted-foreground">
                          {order.workOrderNumber}
                        </span>
                      ) : null}
                    </div>
                    {order.trackingNumber ? (
                      <span className="font-mono text-[10px] text-muted-foreground">
                        📦 {order.trackingNumber}
                      </span>
                    ) : null}
                  </div>
                  <ul className="mt-2 flex flex-col gap-1">
                    {order.lines.map((line, index) => {
                      const done = line.receivedQuantity >= line.quantity;
                      return (
                        <li key={index} className="flex items-center justify-between gap-2 text-xs">
                          <span className={done ? "text-muted-foreground line-through" : ""}>
                            {line.description}
                          </span>
                          <span className="font-mono tabular-nums text-muted-foreground">
                            {line.receivedQuantity}/{line.quantity}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  {order.status === "ORDERED" && outstanding(order) > 0 ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-2"
                      disabled={pending}
                      onClick={() => setConfirmOrder(order)}
                    >
                      Receive all ({outstanding(order)})
                    </Button>
                  ) : null}
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog
        open={confirmOrder !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmOrder(null);
        }}
      >
        <DialogContent>
          <DialogTitle>Receive the full delivery?</DialogTitle>
          <DialogDescription>
            This marks every outstanding line as received
            {confirmOrder?.workOrderNumber ? ` for ${confirmOrder.workOrderNumber}` : ""} — stock
            bumps automatically on linked items. This cannot be undone; short deliveries should be
            received line-by-line instead.
          </DialogDescription>
          <ul className="mt-4 flex flex-col gap-1 rounded-md border border-border p-3 text-sm">
            {confirmOrder?.lines.map((line, index) => {
              const remaining = Math.max(0, line.quantity - line.receivedQuantity);
              return (
                <li key={index} className="flex items-center justify-between gap-2">
                  <span>{line.description}</span>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    +{remaining}
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmOrder(null)} disabled={pending}>
              Cancel
            </Button>
            <Button
              onClick={() => confirmOrder && void receiveAll(confirmOrder)}
              disabled={pending}
            >
              {pending ? "Receiving…" : "Confirm receive all"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
