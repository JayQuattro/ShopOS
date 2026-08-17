"use client";

import { useCallback, useEffect, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/i18n/formatters";
import { AttachmentPanel } from "./attachment-panel";
import { AuthorizationRecorder } from "./authorization-recorder";

export type Revision = {
  id: string;
  revisionNumber: number;
  status: string;
  documentKind: "BASELINE" | "CHANGE_ORDER";
  changeOrderNumber: number | null;
  summaryNote: string | null;
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

function documentLabel(rev: Revision): string {
  return rev.documentKind === "CHANGE_ORDER"
    ? `Change order ${rev.changeOrderNumber ?? "?"}`
    : `Rev ${rev.revisionNumber}`;
}

export function EstimatePanel({
  workOrderId,
  revisions: initialRevisions,
  workOrderStatus,
  canWrite,
  canRecordDecisions,
}: {
  workOrderId: string;
  revisions: Revision[];
  workOrderStatus: string;
  canWrite: boolean;
  canRecordDecisions: boolean;
}) {
  const [revisions, setRevisions] = useState(initialRevisions);
  const [selectedRevId, setSelectedRevId] = useState<string | null>(
    initialRevisions[0]?.id ?? null,
  );
  const [lines, setLines] = useState<Line[]>([]);
  const [loadingLines, setLoadingLines] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const selectedRev = revisions.find((r) => r.id === selectedRevId);
  const isDraft = selectedRev?.status === "DRAFT";
  const isChangeOrder = selectedRev?.documentKind === "CHANGE_ORDER";
  const coAllowed =
    canWrite && (workOrderStatus === "AUTHORIZED" || workOrderStatus === "IN_PROGRESS");

  const loadLines = useCallback(async (revId: string) => {
    setLoadingLines(true);
    try {
      const res = await fetch(`/api/estimate-revisions/${revId}/lines`, { method: "GET" });
      if (res.ok) {
        const data = await res.json();
        setLines(data.lines ?? []);
      } else {
        setLines([]);
      }
    } finally {
      setLoadingLines(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedRevId) return;
    let cancelled = false;
    // Defer past the effect body: line loading is data fetching keyed on the
    // selected document, not an external-system subscription.
    const timer = setTimeout(() => {
      if (!cancelled) void loadLines(selectedRevId);
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [selectedRevId, loadLines]);

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
      const newRev: Revision = {
        id: data.revisionId,
        revisionNumber: data.revisionNumber,
        status: "DRAFT",
        documentKind: "BASELINE",
        changeOrderNumber: null,
        summaryNote: null,
        currency: "USD",
        totalMinor: "0",
      };
      setRevisions((prev) => [newRev, ...prev]);
      setSelectedRevId(newRev.id);
    } catch {
      setError("Could not create a draft revision.");
    } finally {
      setPending(false);
    }
  }

  async function createChangeOrder() {
    setPending(true);
    setError(null);
    try {
      const note = window.prompt(
        "What additional work was found? This note is shown to the customer verbatim.",
      );
      if (!note || note.trim().length < 3) {
        throw new Error("A note of at least 3 characters is required.");
      }
      const res = await fetch(`/api/work-orders/${workOrderId}/change-orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: note.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create change order");
      const newRev: Revision = {
        id: data.revisionId,
        revisionNumber: data.revisionNumber,
        status: "DRAFT",
        documentKind: "CHANGE_ORDER",
        changeOrderNumber: data.changeOrderNumber,
        summaryNote: note.trim(),
        currency: "USD",
        totalMinor: "0",
      };
      setRevisions((prev) => [newRev, ...prev]);
      setSelectedRevId(newRev.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the change order.");
    } finally {
      setPending(false);
    }
  }

  async function presentSelected() {
    if (!selectedRevId) return;
    setPending(true);
    setError(null);
    try {
      const path = isChangeOrder ? "present-change-order" : "present";
      const res = await fetch(`/api/estimate-revisions/${selectedRevId}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to present");
      if (data.autoApplied) {
        window.location.reload();
        return;
      }
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not present the document.");
    } finally {
      setPending(false);
    }
  }

  async function voidSelected() {
    if (
      !selectedRevId ||
      !window.confirm("Void this change order before a decision is recorded?")
    ) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/estimate-revisions/${selectedRevId}/void`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to void");
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not void the change order.");
    } finally {
      setPending(false);
    }
  }

  async function resendLink() {
    if (!selectedRevId) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/estimate-revisions/${selectedRevId}/resend-link`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to resend");
      setError(null);
      setNotice("A fresh authorization link was emailed to the customer.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not re-issue the link.");
    } finally {
      setPending(false);
    }
  }

  // Line form state
  const [lineKind, setLineKind] = useState("LABOR");
  const [lineDesc, setLineDesc] = useState("");
  const [lineQty, setLineQty] = useState("1000");
  const [linePrice, setLinePrice] = useState("0");
  const [lineTaxRate, setLineTaxRate] = useState("0");
  const [lineCredit, setLineCredit] = useState(false);

  async function addLine() {
    if (!selectedRevId || !lineDesc.trim()) return;
    setPending(true);
    setError(null);
    try {
      const unitPrice = Math.abs(parseInt(linePrice, 10) || 0) * (lineCredit ? -1 : 1);
      const res = await fetch(`/api/estimate-revisions/${selectedRevId}/lines`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: lineKind,
          serviceGroupKey: "general",
          description: lineDesc,
          quantityMilli: parseInt(lineQty, 10) || 1000,
          unitPriceMinor: unitPrice,
          discountMinor: 0,
          taxable: !lineCredit && parseInt(lineTaxRate, 10) > 0,
          taxRateBasisPoints: lineCredit ? 0 : parseInt(lineTaxRate, 10) || 0,
          position: lines.length + 1,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to add line");
      }
      await loadLines(selectedRevId);
      setLineDesc("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add the line.");
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
      {notice ? (
        <Alert variant="info">
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap gap-2">
          {revisions.map((rev) => (
            <button
              key={rev.id}
              onClick={() => setSelectedRevId(rev.id)}
              className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                selectedRevId === rev.id
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              {documentLabel(rev)}
              <Badge variant="secondary" className="ml-2 text-xs">
                {rev.status}
              </Badge>
              <span className="ml-2 font-mono text-xs tabular-nums">
                {formatMoney(Number(rev.totalMinor), rev.currency, "en-US")}
              </span>
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          {coAllowed ? (
            <Button variant="default" size="sm" onClick={createChangeOrder} disabled={pending}>
              New change order
            </Button>
          ) : null}
          <Button variant="outline" size="sm" onClick={createDraft} disabled={pending}>
            New revision
          </Button>
        </div>
      </div>

      {selectedRev ? (
        <div className="flex flex-col gap-3">
          {selectedRev.summaryNote ? (
            <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
              {selectedRev.summaryNote}
            </p>
          ) : null}

          {loadingLines ? (
            <p className="text-sm text-muted-foreground">Loading lines…</p>
          ) : lines.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No lines yet.
              {isDraft ? " Add the first line below." : ""}
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Type</th>
                  <th className="py-2 pr-4 font-medium">Description</th>
                  <th className="py-2 pr-4 font-medium text-right">Qty</th>
                  <th className="py-2 pr-4 font-medium text-right">Unit</th>
                  <th className="py-2 pr-4 font-medium text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.id} className="border-b border-border/60">
                    <td className="py-2 pr-4">
                      <Badge variant="outline" className="text-xs">
                        {Number(line.unitPriceMinor) < 0 ? "CREDIT" : line.kind}
                      </Badge>
                    </td>
                    <td className="py-2 pr-4">{line.description}</td>
                    <td className="py-2 pr-4 text-right font-mono tabular-nums">
                      {(line.quantityMilli / 1000).toFixed(1)}
                    </td>
                    <td className="py-2 pr-4 text-right font-mono tabular-nums">
                      {formatMoney(Number(line.unitPriceMinor), selectedRev.currency, "en-US")}
                    </td>
                    <td className="py-2 pr-4 text-right font-mono tabular-nums">
                      {formatMoney(Number(line.totalMinor), selectedRev.currency, "en-US")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {canWrite && isDraft ? (
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
                disabled={lineCredit}
              />
              {isChangeOrder ? (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={lineCredit}
                    onChange={(e) => setLineCredit(e.target.checked)}
                    className="size-4 rounded border-input"
                  />
                  Credit
                </label>
              ) : null}
              <Button size="sm" onClick={addLine} disabled={pending || !lineDesc.trim()}>
                Add line
              </Button>
              <Button size="sm" variant="default" onClick={presentSelected} disabled={pending}>
                {isChangeOrder ? "Present change order" : "Present"}
              </Button>
            </div>
          ) : null}

          {canWrite && selectedRev.status === "PRESENTED" && isChangeOrder ? (
            <div className="flex flex-wrap gap-2 border-t border-border pt-3">
              <Button variant="outline" size="sm" onClick={voidSelected} disabled={pending}>
                Void change order
              </Button>
            </div>
          ) : null}

          {canWrite && selectedRev.status === "PRESENTED" ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={resendLink} disabled={pending}>
                Resend authorization email
              </Button>
            </div>
          ) : null}

          {canWrite && (isDraft || selectedRev.status === "PRESENTED") ? (
            <div className="border-t border-border pt-3">
              <AttachmentPanel
                workOrderId={workOrderId}
                canWrite={canWrite}
                estimateRevisionId={selectedRev.id}
                compact
              />
            </div>
          ) : null}

          {canRecordDecisions && selectedRev.status === "PRESENTED" ? (
            <AuthorizationRecorder revisionId={selectedRev.id} currency={selectedRev.currency} />
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No estimate documents yet. Click &ldquo;New revision&rdquo; to start
          {coAllowed ? ", or \u201cNew change order\u201d once work is authorized" : ""}.
        </p>
      )}
    </div>
  );
}
