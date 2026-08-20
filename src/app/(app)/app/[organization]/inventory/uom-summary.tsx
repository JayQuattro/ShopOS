"use client";

import { useEffect, useState } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type UomGroup = {
  group: string;
  totalBaseUnits: number;
  containers: Array<{
    itemId: string;
    partNumber: string;
    name: string;
    unitOfMeasure: string | null;
    quantityOnHand: number;
    factor: number | null;
  }>;
};

const BASE_UNIT_LABEL: Record<string, string> = {
  volume: "quarts",
  each: "units",
  length: "feet",
};

/** Base-unit stock totals per UoM group — total quarts across containers. */
export function UomSummary() {
  const [groups, setGroups] = useState<UomGroup[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      void (async () => {
        try {
          const res = await fetch("/api/inventory/uom-summary");
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

  if (groups === null || groups.length === 0) return null;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {groups.map((group) => (
        <Card key={group.group}>
          <CardHeader>
            <CardTitle className="text-base capitalize">{group.group}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <p className="text-2xl font-semibold tabular-nums">
              {group.totalBaseUnits.toLocaleString("en-US", { maximumFractionDigits: 1 })}{" "}
              <span className="text-sm font-normal text-muted-foreground">
                {BASE_UNIT_LABEL[group.group] ?? "base units"} total
              </span>
            </p>
            <ul className="flex flex-col divide-y divide-border/60 text-sm">
              {group.containers.map((container) => (
                <li
                  key={container.itemId}
                  className="flex items-center justify-between gap-2 py-1.5"
                >
                  <span className="truncate">
                    <span className="font-mono text-xs">{container.partNumber}</span>
                    <span className="ml-2 text-muted-foreground">{container.name}</span>
                  </span>
                  <span className="shrink-0 font-mono text-xs tabular-nums">
                    {container.quantityOnHand} {container.unitOfMeasure ?? "ea"}
                    {container.factor ? (
                      <span className="ml-1 text-muted-foreground">×{container.factor}</span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
