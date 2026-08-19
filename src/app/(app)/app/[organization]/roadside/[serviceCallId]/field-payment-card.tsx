"use client";

import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { parseMoneyInput } from "@/i18n/money-input";

const METHODS = [
  ["CASH", "Cash"],
  ["CARD_EXTERNAL", "Card"],
  ["CHECK", "Check"],
  ["OTHER", "Other"],
] as const;

/** Settle up on scene: money against the call, straight into the till. */
export function FieldPaymentCard({ orgId, callId }: { orgId: string; callId: string }) {
  const [totalMinor, setTotalMinor] = useState<string | null>(null);
  const [currency, setCurrency] = useState<string>("USD");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<string>("CASH");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch(`/api/organizations/${orgId}/service-calls/${callId}/payment`);
    if (res.ok) {
      const data = await res.json();
      setTotalMinor(data.totalMinor);
      setCurrency(data.currency ?? "USD");
    }
  }

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      if (!cancelled) void refresh();
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, callId]);

  async function collect() {
    const parsed = parseMoneyInput(amount);
    if (parsed === null || parsed <= 0) {
      setError("Enter an amount like 80.00");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/organizations/${orgId}/service-calls/${callId}/payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountMinor: parsed, method }),
      });
      if (!res.ok) throw new Error("Could not record the payment.");
      setAmount("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not record the payment.");
    } finally {
      setPending(false);
    }
  }

  const collected = totalMinor !== null ? Number(totalMinor) / 100 : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-base">
          Payment on scene
          {collected !== null && collected > 0 ? (
            <Badge variant="secondary" className="text-[10px]">
              collected {currency} {collected.toFixed(2)}
            </Badge>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">
          No estimate or invoice needed — settles the call on the spot and lands in your open till.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-sm font-medium">
            Amount
            <Input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="80.00"
              disabled={pending}
              className="h-9 w-28 font-mono text-sm"
            />
          </label>
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            disabled={pending}
            aria-label="Payment method"
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            {METHODS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <Button type="button" disabled={pending} onClick={() => void collect()}>
            {pending ? "Recording…" : "Collect payment"}
          </Button>
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
