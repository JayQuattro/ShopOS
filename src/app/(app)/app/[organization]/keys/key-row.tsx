"use client";

import Link from "next/link";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

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

/** One row of the key board: job identity plus editable tag and location. */
export function KeyRow({ workOrder, canWrite }: { workOrder: KeyedWorkOrder; canWrite: boolean }) {
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
    <tr className="border-b border-border/60 hover:bg-muted/30">
      <td className="px-4 py-3">
        <Link
          href={workOrder.href}
          className="font-mono text-link underline-offset-4 hover:underline"
        >
          {workOrder.number}
        </Link>
      </td>
      <td className="px-4 py-3">
        <p className="font-medium">{workOrder.customerName}</p>
        {workOrder.assetName ? (
          <p className="text-xs text-muted-foreground">{workOrder.assetName}</p>
        ) : null}
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-1">
          {workOrder.bay ? (
            <Badge variant="outline" className="text-[10px]">
              {workOrder.bay}
            </Badge>
          ) : null}
          {workOrder.stage ? (
            <Badge variant="secondary" className="text-[10px]">
              {workOrder.stage.replace(/_/g, " ").toLowerCase()}
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px]">
              not checked in
            </Badge>
          )}
        </div>
      </td>
      <td className="px-4 py-3">
        {canWrite ? (
          <Input
            aria-label={`Key tag for ${workOrder.number}`}
            value={keyTag}
            onChange={(e) => setKeyTag(e.target.value)}
            placeholder="Tag #"
            disabled={pending}
            className="h-8 w-24 font-mono text-xs"
          />
        ) : (
          <span className="font-mono text-xs">{workOrder.keyTag ?? "—"}</span>
        )}
      </td>
      <td className="px-4 py-3">
        {canWrite ? (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              aria-label={`Key location for ${workOrder.number}`}
              value={keyLocation}
              onChange={(e) => setKeyLocation(e.target.value)}
              placeholder="Hook 12 / lockbox B / with Maria"
              disabled={pending}
              className="h-8 w-48 text-xs"
            />
            <select
              aria-label={`Quick location for ${workOrder.number}`}
              value=""
              disabled={pending}
              onChange={(e) => e.target.value && setKeyLocation(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            >
              <option value="">Quick…</option>
              {COMMON_LOCATIONS.map((location) => (
                <option key={location} value={location}>
                  {location}
                </option>
              ))}
            </select>
            {dirty ? (
              <button
                type="button"
                onClick={() => void save()}
                disabled={pending}
                className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
              >
                Save
              </button>
            ) : saved ? (
              <span className="text-xs text-muted-foreground">Saved</span>
            ) : null}
            {error ? <span className="text-xs text-destructive">{error}</span> : null}
          </div>
        ) : (
          <span className="text-xs">{workOrder.keyLocation ?? "—"}</span>
        )}
      </td>
    </tr>
  );
}
