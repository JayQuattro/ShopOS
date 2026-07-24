"use client";

import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/i18n/formatters";

type Revision = {
  id: string;
  revisionNumber: number;
  status: string;
  currency: string;
  totalMinor: string;
};

type Line = {
  id: string;
  kind: string;
  description: string;
  quantityMilli: number;
  unitPriceMinor: string;
  totalMinor: string;
  position: number;
};

export function EstimatePanel({
  workOrderId,
  revisions: initialRevisions,
}: {
  workOrderId: string;
  revisions: Revision[];
}) {
  const [revisions, setRevisions] = useState(initialRevisions);
  const [selectedRevId, setSelectedRevId] = useState<string | null>(
    initialRevisions[0]?.id ?? null,
  );
  const [lines, setLines] = useState<Line[]>([]);
  const [loadingLines, setLoadingLines] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Show line form only for DRAFT revisions.
  const selectedRev = revisions.find((r) => r.id === selectedRevId);
  const isDraft = selectedRev?.status === "DRAFT";

  async function loadLines(revId: string) {
    setLoadingLines(true);
    try {
      const res = await fetch(`/api/estimate-revisions/${revId}/lines`, { method: "GET" });
      if (res.ok) {
        const data = await res.json();
        setLines(data.lines ?? []);
      }
    } finally {
      setLoadingLines(false);
    }
  }

  async function createDraft() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/work-orders/${workOrderId}/estimate-revisions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currency: "USD" }),
      });
      if (!res.ok) throw new Error("Failed to create revision");
      const data = await res.json();
      const newRev = { ...data, status: "DRAFT", currency: "USD", totalMinor: "0" };
      setRevisions((prev) => [newRev, ...prev]);
      setSelectedRevId(newRev.id);
      setLines([]);
    } catch {
      setError("Could not create a draft revision.");
    } finally {
      setPending(false);
    }
  }

  async function presentRevision() {
    if (!selectedRevId) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/estimate-revisions/${selectedRevId}/present`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error("Failed to present");
      setRevisions((prev) =>
        prev.map((r) => (r.id === selectedRevId ? { ...r, status: "PRESENTED" } : r)),
      );
      window.location.reload();
    } catch {
      setError("Could not present the revision.");
    } finally {
      setPending(false);
    }
  }

  // Line form state
  const [lineKind, setLineKind] = useState("LABOR");
  const [lineDesc, setLineDesc] = useState("");
  const [lineQty, setLineQty] = useState("2500");
  const [linePrice, setLinePrice] = useState("0");
  const [lineTaxRate, setLineTaxRate] = useState("0");

  async function addLine() {
    if (!selectedRevId || !lineDesc.trim()) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/estimate-revisions/${selectedRevId}/lines`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: lineKind,
          serviceGroupKey: "general",
          description: lineDesc,
          quantityMilli: parseInt(lineQty, 10) || 1000,
          unitPriceMinor: parseInt(linePrice, 10) || 0,
          discountMinor: 0,
          taxable: parseInt(lineTaxRate, 10) > 0,
          taxRateBasisPoints: parseInt(lineTaxRate, 10) || 0,
          position: lines.length + 1,
        }),
      });
      if (!res.ok) throw new Error("Failed to add line");
      const data = await res.json();
      setLines((prev) => [
        ...prev,
        {
          id: data.lineId,
          kind: lineKind,
          description: lineDesc,
          quantityMilli: parseInt(lineQty, 10) || 1000,
          unitPriceMinor: linePrice,
          totalMinor: "0",
          position: lines.length + 1,
        },
      ]);
      setLineDesc("");
    } catch {
      setError("Could not add the line.");
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

      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-wrap gap-2">
          {revisions.map((rev) => (
            <button
              key={rev.id}
              onClick={() => {
                setSelectedRevId(rev.id);
                if (rev.status !== "DRAFT") {
                  void loadLines(rev.id);
                } else {
                  void loadLines(rev.id);
                }
              }}
              className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                selectedRevId === rev.id
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              Rev {rev.revisionNumber}
              <Badge variant="secondary" className="ml-2 text-xs">
                {rev.status}
              </Badge>
              <span className="ml-2 font-mono text-xs tabular-nums">
                {formatMoney(Number(rev.totalMinor), rev.currency, "en-US")}
              </span>
            </button>
          ))}
        </div>
        <Button variant="outline" size="sm" onClick={createDraft} disabled={pending}>
          New revision
        </Button>
      </div>

      {selectedRevId ? (
        <div className="flex flex-col gap-3">
          {(loadingLines || lines.length === 0) && !isDraft ? (
            <p className="text-sm text-muted-foreground">
              {loadingLines ? "Loading lines…" : "No lines loaded. Click a revision tab."}
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Type</th>
                  <th className="py-2 pr-4 font-medium">Description</th>
                  <th className="py-2 pr-4 font-medium text-right">Qty</th>
                  <th className="py-2 pr-4 font-medium text-right">Unit</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.id} className="border-b border-border/60">
                    <td className="py-2 pr-4">
                      <Badge variant="outline" className="text-xs">
                        {line.kind}
                      </Badge>
                    </td>
                    <td className="py-2 pr-4">{line.description}</td>
                    <td className="py-2 pr-4 text-right font-mono tabular-nums">
                      {(line.quantityMilli / 1000).toFixed(1)}
                    </td>
                    <td className="py-2 pr-4 text-right font-mono tabular-nums">
                      ${(Number(line.unitPriceMinor) / 100).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {isDraft ? (
            <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
              <select
                value={lineKind}
                onChange={(e) => setLineKind(e.target.value)}
                className="h-[var(--control-height)] rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="LABOR">Labor</option>
                <option value="PART">Part</option>
                <option value="FEE">Fee</option>
              </select>
              <Input
                placeholder="Description"
                value={lineDesc}
                onChange={(e) => setLineDesc(e.target.value)}
                className="max-w-xs"
              />
              <Input
                type="number"
                placeholder="Qty (milli)"
                value={lineQty}
                onChange={(e) => setLineQty(e.target.value)}
                className="w-24"
              />
              <Input
                type="number"
                placeholder="Unit ¢"
                value={linePrice}
                onChange={(e) => setLinePrice(e.target.value)}
                className="w-28"
              />
              <Input
                type="number"
                placeholder="Tax bps"
                value={lineTaxRate}
                onChange={(e) => setLineTaxRate(e.target.value)}
                className="w-20"
              />
              <Button size="sm" onClick={addLine} disabled={pending || !lineDesc.trim()}>
                Add line
              </Button>
              <Button size="sm" variant="default" onClick={presentRevision} disabled={pending}>
                Present
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No estimate revisions yet. Click &ldquo;New revision&rdquo; to start.
        </p>
      )}
    </div>
  );
}
