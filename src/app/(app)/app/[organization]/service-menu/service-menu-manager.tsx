"use client";

import { useEffect, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/i18n/formatters";

type Template = {
  id: string;
  name: string;
  notes: string | null;
  lines: Array<{
    id: string;
    kind: string;
    description: string;
    quantityMilli: number;
    unitPriceMinor: string;
    taxable: boolean;
  }>;
  tasks: Array<{ id: string; title: string }>;
};

type DraftLine = {
  kind: "LABOR" | "PART" | "FEE";
  description: string;
  quantityMilli: string;
  unitPriceMinor: string;
  taxable: boolean;
  taxRateBasisPoints: string;
};

const emptyLine: DraftLine = {
  kind: "LABOR",
  description: "",
  quantityMilli: "1000",
  unitPriceMinor: "0",
  taxable: false,
  taxRateBasisPoints: "0",
};

export function ServiceMenuManager({ canWrite }: { canWrite: boolean }) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([{ ...emptyLine }]);
  const [taskTitles, setTaskTitles] = useState("");

  async function load() {
    const res = await fetch("/api/service-templates");
    if (res.ok) {
      const data = await res.json();
      setTemplates(data.templates ?? []);
    }
  }

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

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const validLines = lines.filter((line) => line.description.trim().length >= 2);
    const validTasks = taskTitles
      .split("\n")
      .map((title) => title.trim())
      .filter((title) => title.length >= 3);
    if (name.trim().length < 2 || (validLines.length === 0 && validTasks.length === 0)) return;

    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/service-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          lines: validLines.map((line) => ({
            kind: line.kind,
            serviceGroupKey: "general",
            description: line.description.trim(),
            quantityMilli: Number(line.quantityMilli) || 1000,
            unitPriceMinor: Math.round(Number(line.unitPriceMinor || 0) * 100),
            taxable: line.taxable,
            taxRateBasisPoints: line.taxable ? Number(line.taxRateBasisPoints) || 0 : 0,
          })),
          tasks: validTasks.map((title) => ({ title })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const messages: Record<string, string> = {
          duplicate_name: "A template with that name already exists.",
          empty_template: "Add at least one line or inspection item.",
          invalid_lines: "Check the line details (description, quantity, price).",
          invalid_tasks: "Inspection items need at least 3 characters.",
        };
        throw new Error(messages[data.error] ?? "Could not save the template.");
      }
      setNotice(`Template "${name.trim()}" saved.`);
      setName("");
      setLines([{ ...emptyLine }]);
      setTaskTitles("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the template.");
    } finally {
      setPending(false);
    }
  }

  async function remove(templateId: string, templateName: string) {
    if (!window.confirm(`Delete the "${templateName}" template?`)) return;
    setPending(true);
    try {
      await fetch(`/api/service-templates?templateId=${templateId}`, { method: "DELETE" });
      await load();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {canWrite ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">New template</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="flex flex-col gap-3">
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

              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Template name (e.g. Front brake job)"
                disabled={pending}
              />

              <p className="text-sm font-medium">Priced lines (added to the estimate)</p>
              {lines.map((line, index) => (
                <div key={index} className="flex flex-wrap items-center gap-2">
                  <select
                    value={line.kind}
                    onChange={(e) =>
                      setLines((prev) =>
                        prev.map((l, i) =>
                          i === index ? { ...l, kind: e.target.value as DraftLine["kind"] } : l,
                        ),
                      )
                    }
                    className="h-[var(--control-height)] rounded-md border border-input bg-background px-2 text-sm"
                  >
                    <option value="LABOR">Labor</option>
                    <option value="PART">Part</option>
                    <option value="FEE">Fee</option>
                  </select>
                  <Input
                    value={line.description}
                    onChange={(e) =>
                      setLines((prev) =>
                        prev.map((l, i) =>
                          i === index ? { ...l, description: e.target.value } : l,
                        ),
                      )
                    }
                    placeholder="Description"
                    className="max-w-xs"
                  />
                  <Input
                    type="number"
                    value={line.quantityMilli}
                    onChange={(e) =>
                      setLines((prev) =>
                        prev.map((l, i) =>
                          i === index ? { ...l, quantityMilli: e.target.value } : l,
                        ),
                      )
                    }
                    className="w-20"
                    title="Quantity in milli-units (1000 = 1.0)"
                  />
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={line.unitPriceMinor}
                    onChange={(e) =>
                      setLines((prev) =>
                        prev.map((l, i) =>
                          i === index ? { ...l, unitPriceMinor: e.target.value } : l,
                        ),
                      )
                    }
                    placeholder="Price"
                    className="w-24"
                  />
                  <label className="flex items-center gap-1 text-sm">
                    <input
                      type="checkbox"
                      checked={line.taxable}
                      onChange={(e) =>
                        setLines((prev) =>
                          prev.map((l, i) =>
                            i === index ? { ...l, taxable: e.target.checked } : l,
                          ),
                        )
                      }
                      className="size-4 rounded border-input"
                    />
                    Tax
                  </label>
                  {line.taxable ? (
                    <Input
                      type="number"
                      value={line.taxRateBasisPoints}
                      onChange={(e) =>
                        setLines((prev) =>
                          prev.map((l, i) =>
                            i === index ? { ...l, taxRateBasisPoints: e.target.value } : l,
                          ),
                        )
                      }
                      className="w-20"
                      title="Tax rate in basis points (720 = 7.2%)"
                    />
                  ) : null}
                  {lines.length > 1 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setLines((prev) => prev.filter((_, i) => i !== index))}
                    >
                      Remove
                    </Button>
                  ) : null}
                </div>
              ))}
              <div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setLines((prev) => [...prev, { ...emptyLine }])}
                >
                  Add line
                </Button>
              </div>

              <label className="grid gap-1 text-sm font-medium">
                Inspection items (one per line, added to the checklist)
                <textarea
                  value={taskTitles}
                  onChange={(e) => setTaskTitles(e.target.value)}
                  placeholder={"Front brake pads\nTire tread depth\nBrake fluid condition"}
                  rows={4}
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </label>

              <div>
                <Button type="submit" disabled={pending || name.trim().length < 2}>
                  {pending ? "Saving…" : "Save template"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Templates</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : templates.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No templates yet. Save the jobs and inspections you do most often.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {templates.map((template) => (
                <li key={template.id} className="py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{template.name}</span>
                    {canWrite ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => void remove(template.id, template.name)}
                        disabled={pending}
                      >
                        Delete
                      </Button>
                    ) : null}
                  </div>
                  {template.lines.length > 0 ? (
                    <ul className="mt-1 flex flex-col gap-0.5">
                      {template.lines.map((line) => (
                        <li
                          key={line.id}
                          className="flex justify-between text-xs text-muted-foreground"
                        >
                          <span>
                            {line.kind.toLowerCase()} · {line.description}
                          </span>
                          <span className="font-mono tabular-nums">
                            {formatMoney(Number(line.unitPriceMinor), "USD", "en-US")}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {template.tasks.length > 0 ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Inspection: {template.tasks.map((task) => task.title).join(" · ")}
                    </p>
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
