"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

/** Inline registration/insurance expiry editor for one fleet vehicle. */
export function FleetDocsEditor({
  assetId,
  registration,
  insurance,
}: {
  assetId: string;
  registration: string;
  insurance: string;
}) {
  const [reg, setReg] = useState(registration);
  const [ins, setIns] = useState(insurance);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = reg !== registration || ins !== insurance;

  async function save() {
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/assets/${assetId}/fleet-docs`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          registrationExpiresAt: reg ? new Date(reg).toISOString() : null,
          insuranceExpiresAt: ins ? new Date(ins).toISOString() : null,
        }),
      });
      if (!res.ok) throw new Error("Could not save the dates.");
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the dates.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-2 border-t border-border pt-2">
      <label className="grid gap-1 text-xs font-medium">
        Registration expires
        <Input
          type="date"
          value={reg}
          onChange={(e) => setReg(e.target.value)}
          disabled={pending}
          className="h-8 w-36 text-xs"
          aria-label="Registration expiry"
        />
      </label>
      <label className="grid gap-1 text-xs font-medium">
        Insurance expires
        <Input
          type="date"
          value={ins}
          onChange={(e) => setIns(e.target.value)}
          disabled={pending}
          className="h-8 w-36 text-xs"
          aria-label="Insurance expiry"
        />
      </label>
      {dirty ? (
        <button
          type="button"
          onClick={() => void save()}
          disabled={pending}
          className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save dates"}
        </button>
      ) : saved ? (
        <Badge variant="secondary" className="text-[10px]">
          saved
        </Badge>
      ) : null}
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </div>
  );
}
