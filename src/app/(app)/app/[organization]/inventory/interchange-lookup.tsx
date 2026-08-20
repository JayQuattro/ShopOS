"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Match = {
  itemId: string;
  partNumber: string;
  brand: string | null;
  name: string;
  quantityOnHand: number;
  unitCostMinor: string;
  currency: string;
};

/** OE interchange lookup: what else fits when your brand is out. */
export function InterchangeLookup() {
  const [oeNumber, setOeNumber] = useState("");
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search() {
    if (!oeNumber.trim()) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/inventory/interchange?oeNumber=${encodeURIComponent(oeNumber.trim())}`,
      );
      if (!res.ok) throw new Error("Lookup failed.");
      const data = await res.json();
      setMatches(data.matches ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lookup failed.");
      setMatches(null);
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Interchange lookup</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid flex-1 gap-1 text-sm font-medium">
            OE / interchange number
            <Input
              value={oeNumber}
              onChange={(e) => setOeNumber(e.target.value)}
              placeholder="OE-44100 — find every brand that fits"
              disabled={pending}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void search();
                }
              }}
            />
          </label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending || !oeNumber.trim()}
            onClick={() => void search()}
          >
            {pending ? "Searching…" : "What fits?"}
          </Button>
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {matches !== null ? (
          matches.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No stocked parts carry that OE number yet — add it to a part to build the interchange.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-border/60">
              {matches.map((match) => (
                <li
                  key={match.itemId}
                  className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                >
                  <span>
                    <span className="font-mono text-xs">{match.partNumber}</span>
                    {match.brand ? (
                      <Badge variant="secondary" className="ml-2 text-[10px]">
                        {match.brand}
                      </Badge>
                    ) : null}
                    <span className="ml-2 text-muted-foreground">{match.name}</span>
                  </span>
                  <span className="font-mono text-xs tabular-nums">
                    {match.quantityOnHand} on hand
                  </span>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}
