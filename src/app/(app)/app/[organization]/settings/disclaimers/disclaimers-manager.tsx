"use client";

import { useEffect, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Template = {
  id: string;
  name: string;
  body: string;
  triggerKey: string | null;
  active: boolean;
};

const TRIGGER_LABELS: Readonly<Record<string, string>> = {
  CUSTOMER_PARTS: "Suggested when the invoice has parts not from your stock",
  SUBLET: "Suggested when the job has sublet work",
};

/**
 * The shop's disclaimer library: canned text with an optional situation
 * trigger. Triggered disclaimers are suggested on matching invoices — the
 * writer always decides whether to apply them.
 */
export function DisclaimersManager({ canManage }: { canManage: boolean }) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [triggerKey, setTriggerKey] = useState("");

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        const res = await fetch("/api/disclaimers");
        if (res.ok && !cancelled) {
          const data = await res.json();
          setTemplates(data.templates ?? []);
        }
        if (!cancelled) setLoading(false);
      })();
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  async function refresh() {
    const res = await fetch("/api/disclaimers");
    if (res.ok) {
      const data = await res.json();
      setTemplates(data.templates ?? []);
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/disclaimers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          body: body.trim(),
          ...(triggerKey ? { triggerKey } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data.error === "duplicate_name"
            ? "A disclaimer with that name already exists."
            : "Check the name and text (2+ characters each).",
        );
      }
      setName("");
      setBody("");
      setTriggerKey("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the disclaimer.");
    } finally {
      setPending(false);
    }
  }

  async function toggleActive(template: Template) {
    setPending(true);
    try {
      await fetch("/api/disclaimers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: template.id, active: !template.active }),
      });
      await refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {canManage ? (
          <form
            className="flex flex-col gap-3 rounded-md border border-border p-3"
            onSubmit={create}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-sm font-medium">
                Name
                <Input
                  placeholder="Customer-supplied parts"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={pending}
                />
              </label>
              <label className="grid gap-1 text-sm font-medium">
                Suggest when
                <select
                  value={triggerKey}
                  onChange={(e) => setTriggerKey(e.target.value)}
                  disabled={pending}
                  className="h-[var(--control-height)] rounded-md border border-input bg-background px-2 text-sm font-normal"
                >
                  <option value="">Manual only</option>
                  <option value="CUSTOMER_PARTS">Parts not from your stock</option>
                  <option value="SUBLET">Sublet work on the job</option>
                </select>
              </label>
            </div>
            <label className="grid gap-1 text-sm font-medium">
              Disclaimer text
              <textarea
                placeholder="Warranty covers labor only when the customer supplies parts…"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                disabled={pending}
                rows={3}
                maxLength={2000}
                className="min-h-20 rounded-md border border-input bg-background px-3 py-2 text-sm font-normal"
              />
            </label>
            <div>
              <Button type="submit" size="sm" disabled={pending || !name.trim() || !body.trim()}>
                Add disclaimer
              </Button>
            </div>
          </form>
        ) : null}

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : templates.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No disclaimers yet. Add one for customer-supplied parts, sublet work, warranty terms —
            anything you find yourself retyping.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {templates.map((template) => (
              <li key={template.id} className="rounded-md border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{template.name}</span>
                    {template.triggerKey ? (
                      <Badge variant="outline" className="text-[10px]">
                        {template.triggerKey === "CUSTOMER_PARTS" ? "customer parts" : "sublet"}
                      </Badge>
                    ) : null}
                    {!template.active ? (
                      <Badge variant="secondary" className="text-[10px]">
                        off
                      </Badge>
                    ) : null}
                  </div>
                  {canManage ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => void toggleActive(template)}
                    >
                      {template.active ? "Turn off" : "Turn on"}
                    </Button>
                  ) : null}
                </div>
                <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">
                  {template.body}
                </p>
                {template.triggerKey ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {TRIGGER_LABELS[template.triggerKey]}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
