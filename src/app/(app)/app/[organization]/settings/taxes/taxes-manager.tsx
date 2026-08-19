"use client";

import { useEffect, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type TaxRate = {
  id: string;
  name: string;
  rateBasisPoints: number;
  stackGroup: string | null;
  active: boolean;
};

/** Named tax rates: create, list, deactivate. History keeps resolved rates. */
export function TaxesManager({ canManage }: { canManage: boolean }) {
  const [rates, setRates] = useState<TaxRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [stackGroup, setStackGroup] = useState("");
  const [percent, setPercent] = useState("");

  async function load() {
    const res = await fetch("/api/tax-rates?all=1");
    if (res.ok) {
      const data = await res.json();
      setRates(data.rates ?? []);
    }
  }

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch("/api/tax-rates?all=1");
          if (res.ok && !cancelled) {
            const data = await res.json();
            setRates(data.rates ?? []);
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
    if (!name.trim() || percent === "") return;
    setPending(true);
    setError(null);
    try {
      const bps = Math.round((Number(percent) || 0) * 100);
      const res = await fetch("/api/tax-rates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          name: name.trim(),
          rateBasisPoints: bps,
          ...(stackGroup.trim() ? { stackGroup: stackGroup.trim() } : {}),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const messages: Record<string, string> = {
          duplicate_name: "A rate with that name already exists.",
          invalid_rate: "Rate must be between 0 and 100%.",
        };
        throw new Error(messages[data.error] ?? "Could not create the rate.");
      }
      setName("");
      setStackGroup("");
      setPercent("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the rate.");
    } finally {
      setPending(false);
    }
  }

  async function deactivate(taxRateId: string, rateName: string) {
    if (!window.confirm(`Deactivate "${rateName}"? Existing lines keep their resolved rate.`))
      return;
    setPending(true);
    try {
      await fetch("/api/tax-rates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "deactivate", taxRateId }),
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
              placeholder="State sales tax"
              required
              disabled={pending}
            />
          </label>
          <label className="grid gap-1 text-sm font-medium">
            Rate (%)
            <Input
              type="number"
              min={0}
              max={100}
              step="0.001"
              value={percent}
              onChange={(e) => setPercent(e.target.value)}
              placeholder="6.25"
              required
              disabled={pending}
              className="w-24"
            />
          </label>
          <label className="grid gap-1 text-sm font-medium">
            Stack group (optional)
            <Input
              value={stackGroup}
              onChange={(e) => setStackGroup(e.target.value)}
              placeholder="canada — rates sharing a group apply together"
              disabled={pending}
              className="w-64"
            />
          </label>
          <Button type="submit" size="sm" disabled={pending || !name.trim() || percent === ""}>
            Add rate
          </Button>
        </form>
      ) : null}

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">Loading…</p>
          ) : rates.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-muted-foreground">
              No tax rates yet. Add the rates your shop charges (state, county, environmental) and
              they appear as pickers on estimate and template lines.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {rates.map((rate) => (
                <li key={rate.id} className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{rate.name}</span>
                    {!rate.active ? (
                      <Badge variant="secondary" className="text-[10px]">
                        inactive
                      </Badge>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-sm tabular-nums">
                      {(rate.rateBasisPoints / 100).toFixed(3)}%
                    </span>
                    {canManage && rate.active ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground hover:text-destructive"
                        disabled={pending}
                        onClick={() => void deactivate(rate.id, rate.name)}
                      >
                        Deactivate
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
