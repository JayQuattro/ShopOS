"use client";

import { useCallback, useEffect, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Row = { id: string; name: string; body: string; triggerKey?: string | null };
type Template = {
  id: string;
  name: string;
  body: string;
  triggerKey: string | null;
  active: boolean;
};

/**
 * Disclaimers on one invoice. Situational matches are suggested — never
 * applied automatically; the library is one tap away; anything can be typed
 * once. Applied disclaimers snapshot into the invoice and freeze on issue.
 */
export function InvoiceDisclaimers({
  invoiceId,
  canEdit,
}: {
  invoiceId: string;
  canEdit: boolean;
}) {
  const [applied, setApplied] = useState<Row[]>([]);
  const [suggestions, setSuggestions] = useState<Row[]>([]);
  const [library, setLibrary] = useState<Template[]>([]);
  const [pickedTemplate, setPickedTemplate] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [manualName, setManualName] = useState("");
  const [manualBody, setManualBody] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [res, libraryRes] = await Promise.all([
      fetch(`/api/invoices/${invoiceId}/disclaimers`),
      fetch("/api/disclaimers"),
    ]);
    if (res.ok) {
      const data = await res.json();
      setApplied(data.applied ?? []);
      setSuggestions(data.suggestions ?? []);
    }
    if (libraryRes.ok) {
      const data = await libraryRes.json();
      setLibrary((data.templates ?? []).filter((t: Template) => t.active));
    }
  }, [invoiceId]);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        if (!cancelled) await load();
      })();
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [load]);

  async function post(payload: Record<string, unknown>) {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/disclaimers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data.error === "invoice_not_draft"
            ? "The invoice is issued — its disclaimers are frozen."
            : "Could not add the disclaimer.",
        );
      }
      setPickedTemplate("");
      setManualOpen(false);
      setManualName("");
      setManualBody("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add the disclaimer.");
    } finally {
      setPending(false);
    }
  }

  async function remove(disclaimerId: string) {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/invoices/${invoiceId}/disclaimers?disclaimerId=${disclaimerId}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          data.error === "invoice_not_draft"
            ? "The invoice is issued — its disclaimers are frozen."
            : "Could not remove the disclaimer.",
        );
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove the disclaimer.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-3">
      <p className="text-sm font-semibold">Disclaimers</p>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {canEdit && suggestions.length > 0 ? (
        <div className="rounded-md border border-primary/40 bg-primary/5 p-3">
          <p className="text-xs font-medium text-primary">Suggested for this invoice</p>
          <ul className="mt-2 flex flex-col gap-2">
            {suggestions.map((suggestion) => (
              <li key={suggestion.id} className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{suggestion.name}</p>
                  <p className="line-clamp-2 text-xs text-muted-foreground">{suggestion.body}</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => void post({ templateId: suggestion.id })}
                >
                  Add
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {applied.length === 0 ? (
        <p className="text-sm text-muted-foreground">No disclaimers on this invoice.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {applied.map((row) => (
            <li key={row.id} className="rounded-md border border-border p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium">{row.name}</p>
                {canEdit ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => void remove(row.id)}
                  >
                    Remove
                  </Button>
                ) : (
                  <Badge variant="outline" className="text-[10px]">
                    frozen
                  </Badge>
                )}
              </div>
              <p className="mt-1 whitespace-pre-line text-xs text-muted-foreground">{row.body}</p>
            </li>
          ))}
        </ul>
      )}

      {canEdit ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={pickedTemplate}
              onChange={(e) => setPickedTemplate(e.target.value)}
              disabled={pending}
              aria-label="Add a disclaimer from the library"
              className="h-[var(--control-height)] max-w-72 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="">Add from library…</option>
              {library.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              variant="outline"
              disabled={pending || !pickedTemplate}
              onClick={() => void post({ templateId: pickedTemplate })}
            >
              Add
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending || manualOpen}
              onClick={() => setManualOpen(true)}
            >
              Write one
            </Button>
          </div>
          {manualOpen ? (
            <form
              className="flex flex-col gap-2 rounded-md border border-border p-3"
              onSubmit={(e) => {
                e.preventDefault();
                void post({ name: manualName, body: manualBody });
              }}
            >
              <input
                placeholder="Title — e.g. Storage policy"
                value={manualName}
                onChange={(e) => setManualName(e.target.value)}
                className="h-[var(--control-height)] rounded-md border border-input bg-background px-3 text-sm"
                maxLength={120}
              />
              <textarea
                placeholder="Disclaimer text printed on the invoice…"
                value={manualBody}
                onChange={(e) => setManualBody(e.target.value)}
                rows={3}
                maxLength={2000}
                className="min-h-20 rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
              <div className="flex gap-2">
                <Button
                  type="submit"
                  size="sm"
                  disabled={pending || !manualName.trim() || !manualBody.trim()}
                >
                  Add to invoice
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setManualOpen(false)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
