"use client";

import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type WaitingGroup = {
  supplierName: string;
  orders: Array<{
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
  }>;
};

const PURPOSE_LABEL: Record<string, string> = {
  JOB: "job",
  REPLENISH: "stock",
  ALLOCATION: "allocated",
};

/** The vendor board: every open order per supplier, with line progress. */
export function WaitingByVendor() {
  const [groups, setGroups] = useState<WaitingGroup[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      void (async () => {
        try {
          const res = await fetch("/api/parts/waiting");
          if (res.ok && !cancelled) {
            const data = await res.json();
            if (!cancelled) setGroups(data.groups ?? []);
          }
        } catch {
          if (!cancelled) setGroups([]);
        }
      })();
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  if (groups === null) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (groups.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nothing waiting on vendors — every order is received.
      </p>
    );
  }

  return (
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
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
