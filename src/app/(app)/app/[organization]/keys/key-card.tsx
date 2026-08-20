"use client";

import Link from "next/link";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { humanizeToken } from "@/lib/labels";
import { cn } from "@/lib/utils";

type KeyedWorkOrder = {
  id: string;
  number: string;
  stage: string | null;
  bay: string | null;
  customerName: string;
  assetName: string | null;
  keyTag: string | null;
  keyLocation: string | null;
  href: string;
};

const COMMON_LOCATIONS = ["Hook", "Lockbox", "With technician", "In vehicle", "Front desk"];

/**
 * One card of the key board: job identity, a big readable key tag, and
 * touch-sized controls. Quick-location chips cover the common spots; the
 * free-text field handles everything else.
 */
export function KeyCard({ workOrder, canWrite }: { workOrder: KeyedWorkOrder; canWrite: boolean }) {
  const [keyTag, setKeyTag] = useState(workOrder.keyTag ?? "");
  const [keyLocation, setKeyLocation] = useState(workOrder.keyLocation ?? "");
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    keyTag !== (workOrder.keyTag ?? "") || keyLocation !== (workOrder.keyLocation ?? "");

  async function save() {
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/work-orders/${workOrder.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keyTag: keyTag.trim() || null,
          keyLocation: keyLocation.trim() || null,
        }),
      });
      if (!res.ok) throw new Error("Could not save the key info.");
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the key info.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <Link
              href={workOrder.href}
              className="font-mono text-sm font-medium text-link underline-offset-4 hover:underline"
            >
              {workOrder.number}
            </Link>
            <p className="truncate text-sm font-medium">{workOrder.customerName}</p>
            <p className="truncate text-xs text-muted-foreground">
              {workOrder.assetName ?? "No vehicle"}
            </p>
          </div>
          {workOrder.keyTag ? (
            <span className="rounded-lg bg-muted px-3 py-1.5 font-mono text-xl font-bold tabular-nums">
              {workOrder.keyTag}
            </span>
          ) : (
            <Badge variant="outline">no tag</Badge>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {workOrder.bay ? (
            <Badge variant="outline" className="text-[10px]">
              {workOrder.bay}
            </Badge>
          ) : null}
          {workOrder.stage ? (
            <Badge variant="secondary" className="text-[10px]">
              {humanizeToken(workOrder.stage)}
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px]">
              not checked in
            </Badge>
          )}
        </div>

        {canWrite ? (
          <div className="flex flex-col gap-2 border-t border-border pt-3">
            <Input
              aria-label={`Key tag for ${workOrder.number}`}
              value={keyTag}
              onChange={(e) => setKeyTag(e.target.value)}
              placeholder="Tag #"
              disabled={pending}
              className="font-mono"
              inputMode="numeric"
            />
            <div className="flex flex-wrap gap-1.5">
              {COMMON_LOCATIONS.map((location) => (
                <button
                  key={location}
                  type="button"
                  disabled={pending}
                  onClick={() => setKeyLocation(location)}
                  className={cn(
                    "min-h-9 rounded-full border px-3 text-xs font-medium transition-colors disabled:opacity-50",
                    keyLocation === location
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-muted active:bg-muted",
                  )}
                >
                  {location}
                </button>
              ))}
            </div>
            <Input
              aria-label={`Key location for ${workOrder.number}`}
              value={keyLocation}
              onChange={(e) => setKeyLocation(e.target.value)}
              placeholder="Hook 12 / lockbox B / with Maria"
              disabled={pending}
            />
            {dirty ? (
              <Button size="sm" onClick={() => void save()} disabled={pending}>
                {pending ? "Saving…" : "Save key info"}
              </Button>
            ) : saved ? (
              <p className="text-xs text-muted-foreground">Saved ✓</p>
            ) : null}
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
          </div>
        ) : (
          <p className="border-t border-border pt-3 text-sm text-muted-foreground">
            {workOrder.keyLocation ?? "Location not set"}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
