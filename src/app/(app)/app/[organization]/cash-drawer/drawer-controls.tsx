"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function parseMoneyInput(value: string): number | null {
  const trimmed = value.trim().replace(/[$,]/g, "");
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
}

/** Open a drawer with a starting float, or count the cash and close it. */
export function DrawerControls({
  orgId,
  mode,
  locationId,
  sessionId,
  locationName,
  currency,
  shared,
}: {
  orgId: string;
  mode: "open" | "close";
  locationId?: string;
  sessionId?: string;
  locationName: string;
  currency: string;
  shared?: boolean;
}) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const minor = parseMoneyInput(amount);
    if (minor === null) {
      setError("Enter an amount like 250.00");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/organizations/${orgId}/cash-drawer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "open"
            ? {
                action: "open",
                locationId: locationId!,
                currency,
                openingFloatMinor: minor,
                ...(note ? { note } : {}),
                ...(shared ? { shared: true } : {}),
              }
            : {
                action: "close",
                sessionId: sessionId!,
                countedCashMinor: minor,
                ...(note ? { note } : {}),
              },
        ),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        const messages: Record<string, string> = {
          drawer_already_open: "This drawer is already open.",
          session_not_open: "This drawer was already closed.",
          invalid_amount: "Enter an amount like 250.00",
        };
        throw new Error(messages[data.error ?? ""] ?? "Could not update the drawer.");
      }
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the drawer.");
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-sm font-medium">
          {mode === "open" ? "Starting float" : "Counted cash"}
          <Input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="250.00"
            disabled={pending}
            className="h-9 w-32 font-mono text-sm"
          />
        </label>
        <label className="grid flex-1 gap-1 text-sm font-medium">
          Note
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={
              mode === "open" ? "Who opened, anything odd…" : "Where the difference went…"
            }
            disabled={pending}
            className="h-9 text-sm"
          />
        </label>
        <Button type="button" disabled={pending} onClick={() => void submit()}>
          {pending ? "Working…" : mode === "open" ? `Open ${locationName}` : "Close drawer"}
        </Button>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
