"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/i18n/formatters";
import { humanizeToken } from "@/lib/labels";
import { AttachmentPanel } from "./attachment-panel";
import { AuthorizationRecorder } from "./authorization-recorder";
import { EstimateLinesEditor } from "./estimate-lines-editor";

type TaxRateOption = { id: string; name: string; rateBasisPoints: number };

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
  serviceGroupKey: string;
  serviceGroupLabel: string | null;
  optionGroupLabel: string | null;
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
  const [taxRates, setTaxRates] = useState<TaxRateOption[]>([]);

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
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch("/api/tax-rates");
          if (res.ok && !cancelled) {
            const data = await res.json();
            setTaxRates(data.rates ?? []);
          }
        } catch {
          // Rate picker is optional chrome; raw bps entry still works.
        }
      })();
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
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

  // Canned-job speed path: search templates and apply in one click.
  const [templates, setTemplates] = useState<
    Array<{ id: string; name: string; notes: string | null; lines: unknown[] }>
  >([]);
  const [cannedQuery, setCannedQuery] = useState("");

  // Line form state
  const [lineKind, setLineKind] = useState("LABOR");
  const [lineDesc, setLineDesc] = useState("");
  const [lineQty, setLineQty] = useState("1000");
  const [linePrice, setLinePrice] = useState("0");
  const [lineTaxRate, setLineTaxRate] = useState("0"); // rate id, "0" (none), or "custom"
  const [lineCredit, setLineCredit] = useState(false);
  const [lineOptionGroup, setLineOptionGroup] = useState("");
  // Job targeting for new lines: an existing group label, "none", or "new".
  const [lineJobSelect, setLineJobSelect] = useState("__none__");
  const [lineJobText, setLineJobText] = useState("");

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      void (async () => {
        try {
          const res = await fetch("/api/service-templates");
          if (res.ok && !cancelled) {
            const data = await res.json();
            if (!cancelled) setTemplates(data.templates ?? []);
          }
        } catch {
          /* canned jobs are optional chrome */
        }
      })();
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  async function applyCannedJob(templateId: string) {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/work-orders/${workOrderId}/apply-template`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const messages: Record<string, string> = {
          template_not_found: "That canned job no longer exists.",
          work_order_not_found: "This work order no longer exists.",
        };
        throw new Error(messages[body.error ?? ""] ?? "Could not apply the canned job.");
      }
      const data = await res.json();
      setCannedQuery("");
      if (selectedRevId && data.revisionId === selectedRevId) await loadLines(selectedRevId);
      else window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not apply the canned job.");
    } finally {
      setPending(false);
    }
  }

  const jobOptions = useMemo(() => {
    const labels = new Set<string>();
    for (const line of lines) {
      if (line.serviceGroupKey === "general") continue;
      labels.add(line.serviceGroupLabel ?? humanizeToken(line.serviceGroupKey));
    }
    return [...labels];
  }, [lines]);
  const jobLabelForNewLine =
    lineJobSelect === "__new__"
      ? lineJobText.trim()
      : lineJobSelect === "__none__"
        ? ""
        : lineJobSelect;

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
          // Job grouping: slugified label becomes the key; ungrouped lines stay "general".
          serviceGroupKey:
            jobLabelForNewLine.length > 0
              ? jobLabelForNewLine
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, "-")
                  .replace(/^-+|-+$/g, "")
              : "general",
          ...(jobLabelForNewLine ? { serviceGroupLabel: jobLabelForNewLine } : {}),
          description: lineDesc,
          quantityMilli: parseInt(lineQty, 10) || 1000,
          unitPriceMinor: unitPrice,
          discountMinor: 0,
          taxable: !lineCredit && lineTaxRate !== "0" && lineTaxRate !== "custom",
          // Named rates are sent by id so stacks (GST + PST) resolve server-side.
          ...(lineTaxRate !== "0" && lineTaxRate !== "custom"
            ? {
                taxRateId: lineTaxRate,
                taxRateBasisPoints:
                  taxRates.find((rate) => rate.id === lineTaxRate)?.rateBasisPoints ?? 0,
              }
            : {
                taxRateBasisPoints:
                  lineCredit || lineTaxRate === "custom" ? parseInt(lineTaxRate, 10) || 0 : 0,
              }),
          position: lines.length + 1,
          ...(lineOptionGroup.trim()
            ? {
                optionGroupKey: lineOptionGroup
                  .trim()
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, "-")
                  .replace(/^-+|-+$/g, ""),
                optionGroupLabel: lineOptionGroup.trim(),
              }
            : {}),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to add line");
      }
      await loadLines(selectedRevId);
      setLineDesc("");
      setLineOptionGroup("");
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
          ) : isDraft ? (
            <EstimateLinesEditor
              revisionId={selectedRev.id}
              currency={selectedRev.currency}
              lines={lines}
              onChanged={() => (selectedRevId ? loadLines(selectedRevId) : undefined)}
              onRequestAddToGroup={(label: string) => {
                setLineJobSelect(label);
                document.getElementById("estimate-line-description")?.focus();
              }}
            />
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
                {(() => {
                  const groups = new Map<string, Line[]>();
                  for (const line of lines) {
                    const list = groups.get(line.serviceGroupKey) ?? [];
                    list.push(line);
                    groups.set(line.serviceGroupKey, list);
                  }
                  return [...groups.entries()].map(([key, groupLines]) => {
                    const label =
                      groupLines[0]?.serviceGroupLabel ??
                      (key === "general" ? "Other items" : humanizeToken(key));
                    const subtotal = groupLines.reduce(
                      (sum, line) => sum + Number(line.totalMinor),
                      0,
                    );
                    return (
                      <Fragment key={key}>
                        <tr className="border-b border-border bg-muted/40">
                          <th
                            colSpan={5}
                            className="px-3 py-1.5 text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase"
                          >
                            {label}
                          </th>
                        </tr>
                        {groupLines.map((line) => (
                          <tr key={line.id} className="border-b border-border/60">
                            <td className="py-2 pr-4">
                              <Badge variant="outline" className="text-xs">
                                {Number(line.unitPriceMinor) < 0 ? "CREDIT" : line.kind}
                              </Badge>
                            </td>
                            <td className="py-2 pr-4">
                              {line.description}
                              {line.optionGroupLabel ? (
                                <Badge variant="secondary" className="ml-2 text-[10px]">
                                  option · {line.optionGroupLabel}
                                </Badge>
                              ) : null}
                            </td>
                            <td className="py-2 pr-4 text-right font-mono tabular-nums">
                              {(line.quantityMilli / 1000).toFixed(1)}
                            </td>
                            <td className="py-2 pr-4 text-right font-mono tabular-nums">
                              {formatMoney(
                                Number(line.unitPriceMinor),
                                selectedRev.currency,
                                "en-US",
                              )}
                            </td>
                            <td className="py-2 pr-4 text-right font-mono tabular-nums">
                              {formatMoney(Number(line.totalMinor), selectedRev.currency, "en-US")}
                            </td>
                          </tr>
                        ))}
                        <tr className="border-b border-border">
                          <td
                            colSpan={4}
                            className="py-1 pr-4 text-right text-xs text-muted-foreground"
                          >
                            {label} subtotal
                          </td>
                          <td className="py-1 pr-4 text-right font-mono text-xs tabular-nums">
                            {formatMoney(subtotal, selectedRev.currency, "en-US")}
                          </td>
                        </tr>
                      </Fragment>
                    );
                  });
                })()}
              </tbody>
              <tfoot>
                <tr className="border-t border-border">
                  <td colSpan={4} className="pt-2 pr-4 text-right text-sm font-semibold">
                    Total
                  </td>
                  <td className="pt-2 pr-4 text-right font-mono text-sm font-semibold tabular-nums">
                    {formatMoney(Number(selectedRev.totalMinor), selectedRev.currency, "en-US")}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}

          {canWrite && isDraft ? (
            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
              <input
                list="canned-jobs-list"
                value={cannedQuery}
                onChange={(e) => setCannedQuery(e.target.value)}
                placeholder="Canned job — type to search (oil change, brakes…)"
                disabled={pending}
                aria-label="Search canned jobs"
                className="h-[var(--control-height)] min-w-56 flex-1 rounded-md border border-input bg-background px-3 text-sm"
              />
              <datalist id="canned-jobs-list">
                {templates.map((template) => (
                  <option key={template.id} value={template.name} />
                ))}
              </datalist>
              {(() => {
                const match = templates.find(
                  (template) => template.name.toLowerCase() === cannedQuery.trim().toLowerCase(),
                );
                return match ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => void applyCannedJob(match.id)}
                    className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
                  >
                    Add canned job ({match.lines.length} line{match.lines.length === 1 ? "" : "s"})
                  </button>
                ) : null;
              })()}
            </div>
          ) : null}

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
                id="estimate-line-description"
                placeholder="Description"
                value={lineDesc}
                onChange={(e) => setLineDesc(e.target.value)}
                className="max-w-xs"
              />
              <select
                value={lineJobSelect}
                onChange={(e) => setLineJobSelect(e.target.value)}
                className="h-[var(--control-height)] rounded-md border border-input bg-background px-2 text-sm"
                title="Lines that share a job are grouped together on the estimate and authorization (e.g. rotors + labor under Front brakes)"
                aria-label="Job for the new line"
              >
                <option value="__none__">No job (other items)</option>
                {jobOptions.map((label: string) => (
                  <option key={label} value={label}>
                    {label}
                  </option>
                ))}
                <option value="__new__">New job…</option>
              </select>
              {lineJobSelect === "__new__" ? (
                <Input
                  placeholder="Job name — Front brakes…"
                  value={lineJobText}
                  onChange={(e) => setLineJobText(e.target.value)}
                  className="max-w-[180px]"
                />
              ) : null}
              <Input
                placeholder="Option group (optional)"
                value={lineOptionGroup}
                onChange={(e) => setLineOptionGroup(e.target.value)}
                className="max-w-[200px]"
                title="Lines that share an option group are alternatives — the customer picks one (e.g. regular vs premium oil change)"
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
              {taxRates.length > 0 ? (
                <select
                  value={lineTaxRate}
                  onChange={(e) => setLineTaxRate(e.target.value)}
                  disabled={lineCredit || pending}
                  className="h-[var(--control-height)] rounded-md border border-input bg-background px-2 text-sm"
                  title="Tax rate (named rates from Settings → Taxes; Custom for a basis-points value)"
                >
                  <option value="0">No tax</option>
                  {taxRates.map((rate) => (
                    <option key={rate.id} value={rate.id}>
                      {rate.name} ({(rate.rateBasisPoints / 100).toFixed(3)}%)
                    </option>
                  ))}
                  <option value="custom">Custom…</option>
                </select>
              ) : null}
              {taxRates.length === 0 || lineTaxRate === "custom" ? (
                <Input
                  type="number"
                  placeholder="Tax bps"
                  value={lineTaxRate === "custom" ? "" : lineTaxRate}
                  onChange={(e) => setLineTaxRate(e.target.value)}
                  className="w-20"
                  disabled={lineCredit}
                />
              ) : null}
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

          {selectedRev.status === "PRESENTED" ? (
            <div className="flex flex-wrap gap-2">
              <a
                href={`#`}
                onClick={(e) => {
                  e.preventDefault();
                  const orgId = window.location.pathname.split("/")[2] ?? "";
                  window.open(`/print/${orgId}/estimate/${selectedRev.id}`, "_blank", "noreferrer");
                }}
                className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted"
              >
                Print {isChangeOrder ? "change order" : "estimate"}
              </a>
              {canWrite ? (
                <Button variant="outline" size="sm" onClick={resendLink} disabled={pending}>
                  Resend authorization email
                </Button>
              ) : null}
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
