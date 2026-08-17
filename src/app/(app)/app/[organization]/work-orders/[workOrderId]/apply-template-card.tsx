"use client";

import { useEffect, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

type Template = { id: string; name: string };

export function ApplyTemplateCard({
  workOrderId,
  canWrite,
}: {
  workOrderId: string;
  canWrite: boolean;
}) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch("/api/service-templates");
          if (res.ok && !cancelled) {
            const data = await res.json();
            setTemplates(data.templates ?? []);
          }
        } catch {
          // Leave the selector empty; applying is still possible after reload.
        }
      })();
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  async function apply() {
    if (!templateId) return;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/work-orders/${workOrderId}/apply-template`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data.error === "template_not_found" || data.error === "work_order_not_found"
            ? "That template no longer exists."
            : "Could not apply the template.",
        );
      }
      setNotice(
        `Added ${data.linesAdded} estimate line${data.linesAdded === 1 ? "" : "s"} and ` +
          `${data.tasksAdded} checklist item${data.tasksAdded === 1 ? "" : "s"}.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not apply the template.");
    } finally {
      setPending(false);
    }
  }

  if (templates.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <select
          value={templateId}
          onChange={(e) => setTemplateId(e.target.value)}
          disabled={pending || !canWrite}
          className="h-[var(--control-height)] min-w-48 rounded-md border border-input bg-background px-3 text-sm"
          aria-label="Apply a service template"
        >
          <option value="">Apply a service template…</option>
          {templates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          variant="outline"
          onClick={apply}
          disabled={pending || !templateId || !canWrite}
        >
          {pending ? "Applying…" : "Apply"}
        </Button>
      </div>
      {notice ? (
        <Alert variant="info">
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
