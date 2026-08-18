"use client";

import { useEffect, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/i18n/formatters";

type Fee = {
  id: string;
  name: string;
  calculation: "FLAT" | "PERCENT_OF_LABOR";
  amountMinor: string;
  rateBasisPoints: number;
  maxAmountMinor: string | null;
  taxable: boolean;
  taxRateBasisPoints: number;
  appliesTo: "BASELINE" | "CHANGE_ORDER" | "BOTH";
  active: boolean;
};

/** Shop fees: flat or %-of-labor recurring charges auto-added at presentation. */
export function FeesManager({ canManage }: { canManage: boolean }) {
  const [fees, setFees] = useState<Fee[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [calculation, setCalculation] = useState<"FLAT" | "PERCENT_OF_LABOR">("FLAT");
  const [flatAmount, setFlatAmount] = useState("");
  const [percent, setPercent] = useState("");
  const [cap, setCap] = useState("");
  const [taxable, setTaxable] = useState(false);

  async function load() {
    const res = await fetch("/api/shop-fees?all=1");
    if (res.ok) {
      const data = await res.json();
      setFees(data.fees ?? []);
    }
  }

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch("/api/shop-fees?all=1");
          if (res.ok && !cancelled) {
            const data = await res.json();
            setFees(data.fees ?? []);
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
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/shop-fees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          name: name.trim(),
          calculation,
          amountMinor: calculation === "FLAT" ? Math.round((Number(flatAmount) || 0) * 100) : 0,
          rateBasisPoints:
            calculation === "PERCENT_OF_LABOR" ? Math.round((Number(percent) || 0) * 100) : 0,
          ...(calculation === "PERCENT_OF_LABOR" && cap
            ? { maxAmountMinor: Math.round((Number(cap) || 0) * 100) }
            : {}),
          taxable,
          taxRateBasisPoints: taxable ? 720 : 0,
          appliesTo: "BOTH",
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const messages: Record<string, string> = {
          duplicate_name: "A fee with that name already exists.",
          invalid_amount: "Check the amount, percent, and cap values.",
        };
        throw new Error(messages[data.error] ?? "Could not create the fee.");
      }
      setName("");
      setFlatAmount("");
      setPercent("");
      setCap("");
      setTaxable(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the fee.");
    } finally {
      setPending(false);
    }
  }

  async function deactivate(feeId: string, feeName: string) {
    if (!window.confirm(`Deactivate "${feeName}"? Presented documents keep their fee lines.`))
      return;
    setPending(true);
    try {
      await fetch("/api/shop-fees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "deactivate", feeId }),
      });
      await load();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {canManage ? (
        <form onSubmit={create} className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-sm font-medium">
            Name
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Shop supplies"
              required
              disabled={pending}
            />
          </label>
          <select
            value={calculation}
            onChange={(e) => setCalculation(e.target.value as "FLAT" | "PERCENT_OF_LABOR")}
            className="h-[var(--control-height)] rounded-md border border-input bg-background px-2 text-sm"
            disabled={pending}
          >
            <option value="FLAT">Flat</option>
            <option value="PERCENT_OF_LABOR">% of labor</option>
          </select>
          {calculation === "FLAT" ? (
            <label className="grid gap-1 text-sm font-medium">
              Amount
              <Input
                type="number"
                min={0}
                step="0.01"
                value={flatAmount}
                onChange={(e) => setFlatAmount(e.target.value)}
                placeholder="4.50"
                className="w-24"
                disabled={pending}
              />
            </label>
          ) : (
            <>
              <label className="grid gap-1 text-sm font-medium">
                %
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step="0.1"
                  value={percent}
                  onChange={(e) => setPercent(e.target.value)}
                  placeholder="3"
                  className="w-20"
                  disabled={pending}
                />
              </label>
              <label className="grid gap-1 text-sm font-medium">
                Max cap
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={cap}
                  onChange={(e) => setCap(e.target.value)}
                  placeholder="25.00"
                  className="w-24"
                  disabled={pending}
                />
              </label>
            </>
          )}
          <label className="flex items-center gap-2 pb-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={taxable}
              onChange={(e) => setTaxable(e.target.checked)}
              className="size-4 rounded border-input"
              disabled={pending}
            />
            Taxable (shop rate)
          </label>
          <Button type="submit" size="sm" disabled={pending || !name.trim()}>
            Add fee
          </Button>
        </form>
      ) : null}

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">Loading…</p>
          ) : fees.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-muted-foreground">
              No fees yet. Common fees: shop supplies (% of labor, capped), hazmat / disposal
              (flat), environmental fee. They appear as lines on presented estimates and follow the
              normal approval flow.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {fees.map((fee) => (
                <li key={fee.id} className="flex items-center justify-between gap-2 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">
                      {fee.name}
                      {!fee.active ? (
                        <Badge variant="secondary" className="ml-2 text-[10px]">
                          inactive
                        </Badge>
                      ) : null}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {fee.calculation === "FLAT"
                        ? `${formatMoney(Number(fee.amountMinor), "USD", "en-US")} flat`
                        : `${(fee.rateBasisPoints / 100).toFixed(1)}% of labor${
                            fee.maxAmountMinor
                              ? ` · max ${formatMoney(Number(fee.maxAmountMinor), "USD", "en-US")}`
                              : ""
                          }`}
                      {fee.taxable ? " · taxable" : ""}
                      {" · "}
                      {fee.appliesTo === "BOTH"
                        ? "all estimates"
                        : fee.appliesTo === "BASELINE"
                          ? "baselines only"
                          : "change orders only"}
                    </p>
                  </div>
                  {canManage && fee.active ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-destructive"
                      disabled={pending}
                      onClick={() => void deactivate(fee.id, fee.name)}
                    >
                      Deactivate
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
