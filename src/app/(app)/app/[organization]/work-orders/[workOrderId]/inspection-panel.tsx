"use client";

import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type InspectionItemRow = {
  id: string;
  position: number;
  zone: string | null;
  component: string;
  condition: "OK" | "WATCH" | "REPLACE" | "NA";
  note: string | null;
  recommended: boolean;
  attachments: Array<{ id: string; fileName: string; contentType: string }>;
};

type InspectionRow = {
  id: string;
  title: string;
  status: "draft" | "completed" | "shared";
  sharedToken: string | null;
  completedAt: string | null;
  items: InspectionItemRow[];
};

type TemplateOption = { id: string; name: string };

const CONDITION_STYLES: Record<
  InspectionItemRow["condition"],
  { label: string; className: string }
> = {
  OK: {
    label: "OK",
    className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  WATCH: {
    label: "Watch",
    className: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  REPLACE: {
    label: "Replace",
    className: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400",
  },
  NA: { label: "N/A", className: "border-border text-muted-foreground" },
};

/**
 * The digital vehicle inspection: checklist rows with one-tap condition
 * verdicts, per-row photo capture, and complete/share. REPLACE rows flag
 * recommendations for the estimate.
 */
export function InspectionPanel({
  workOrderId,
  templates,
  canWrite,
}: {
  workOrderId: string;
  templates: ReadonlyArray<TemplateOption>;
  canWrite: boolean;
}) {
  const [inspections, setInspections] = useState<InspectionRow[] | null>(null);
  const [title, setTitle] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [newComponent, setNewComponent] = useState("");
  const [newZone, setNewZone] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch(`/api/work-orders/${workOrderId}/inspections`);
    if (res.ok) {
      const data = await res.json();
      setInspections(data.inspections ?? []);
    }
  }

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      if (!cancelled) void refresh();
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workOrderId]);

  async function post(path: string, body: Record<string, unknown>, method = "POST") {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/work-orders/${workOrderId}${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const messages: Record<string, string> = {
          not_draft: "This inspection is completed and read-only.",
          inspection_not_found: "This inspection no longer exists.",
          template_not_found: "That checklist no longer exists.",
        };
        throw new Error(messages[data.error ?? ""] ?? "Action failed.");
      }
      await refresh();
      return await res.json().catch(() => ({}));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed.");
      return null;
    } finally {
      setPending(false);
    }
  }

  async function uploadPhoto(itemId: string, file: File) {
    setPending(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("inspectionItemId", itemId);
      const res = await fetch(`/api/work-orders/${workOrderId}/attachments`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const messages: Record<string, string> = {
          file_too_large: "That file is too large.",
          invalid_content_type: "Photos and video only.",
          storage_not_configured: "Connect storage in platform settings first.",
        };
        throw new Error(messages[data.error ?? ""] ?? "Upload failed.");
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setPending(false);
    }
  }

  const shareUrl = (token: string) => `${window.location.origin}/inspect/${token}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Inspections</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {inspections === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : inspections.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No inspections yet. Start one to record conditions with photos — REPLACE rows feed the
            estimate.
          </p>
        ) : (
          inspections.map((inspection) => (
            <div key={inspection.id} className="rounded-lg border border-border">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
                <span className="text-sm font-medium">{inspection.title}</span>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="text-[10px]">
                    {inspection.status}
                  </Badge>
                  {inspection.status === "draft" && canWrite ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={pending}
                      onClick={() =>
                        void post(`/inspections/${inspection.id}`, { action: "complete" })
                      }
                    >
                      Complete
                    </Button>
                  ) : null}
                  {inspection.status !== "draft" && canWrite ? (
                    inspection.sharedToken ? (
                      <a
                        href={shareUrl(inspection.sharedToken)}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted"
                      >
                        Share link ↗
                      </a>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={pending}
                        onClick={() =>
                          void post(`/inspections/${inspection.id}`, { action: "share" })
                        }
                      >
                        Share with customer
                      </Button>
                    )
                  ) : null}
                </div>
              </div>
              <ul className="divide-y divide-border/60">
                {inspection.items.map((item) => (
                  <li key={item.id} className="flex flex-col gap-2 px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm">
                        {item.zone ? (
                          <span className="mr-1 font-mono text-xs text-muted-foreground">
                            {item.zone}
                          </span>
                        ) : null}
                        {item.component}
                      </span>
                      {item.recommended && canWrite && inspection.status === "completed" ? (
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() =>
                            void post(`/inspections/${inspection.id}/recommend`, {
                              action: "recommend",
                              itemId: item.id,
                            })
                          }
                          className="rounded-md bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
                        >
                          Add to estimate →
                        </button>
                      ) : null}
                      {inspection.status === "draft" && canWrite ? (
                        <div className="flex gap-1">
                          {(["OK", "WATCH", "REPLACE", "NA"] as const).map((condition) => (
                            <button
                              key={condition}
                              type="button"
                              disabled={pending}
                              onClick={() =>
                                void post(`/inspections/${inspection.id}`, {
                                  action: "set-condition",
                                  itemId: item.id,
                                  condition,
                                  ...(item.note ? { note: item.note } : {}),
                                })
                              }
                              className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
                                item.condition === condition
                                  ? CONDITION_STYLES[condition].className
                                  : "border-border text-muted-foreground hover:bg-muted"
                              }`}
                            >
                              {CONDITION_STYLES[condition].label}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <span
                          className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${CONDITION_STYLES[item.condition].className}`}
                        >
                          {CONDITION_STYLES[item.condition].label}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {item.attachments.map((attachment) => (
                        <a
                          key={attachment.id}
                          href={`/api/work-orders/${workOrderId}/attachments/${attachment.id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-md border border-border px-2 py-0.5 text-xs text-link hover:bg-muted"
                        >
                          {attachment.contentType.startsWith("video") ? "🎬" : "📷"}{" "}
                          {attachment.fileName.slice(0, 24)}
                        </a>
                      ))}
                      {inspection.status === "draft" && canWrite ? (
                        <label className="cursor-pointer rounded-md border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted">
                          + Photo / video
                          <input
                            type="file"
                            accept="image/*,video/*"
                            className="hidden"
                            disabled={pending}
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) void uploadPhoto(item.id, file);
                              e.target.value = "";
                            }}
                          />
                        </label>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
              {inspection.status === "draft" && canWrite ? (
                <div className="flex flex-wrap items-end gap-2 border-t border-border px-3 py-2">
                  <Input
                    value={newZone}
                    onChange={(e) => setNewZone(e.target.value)}
                    placeholder="Zone (Brakes)"
                    disabled={pending}
                    className="h-8 w-28 text-xs"
                    aria-label="New item zone"
                  />
                  <Input
                    value={newComponent}
                    onChange={(e) => setNewComponent(e.target.value)}
                    placeholder="Add a row (e.g. Wiper blades)"
                    disabled={pending}
                    className="h-8 flex-1 text-xs"
                    aria-label="New inspection row"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pending || newComponent.trim().length < 1}
                    onClick={async () => {
                      await post(`/inspections/${inspection.id}`, {
                        action: "add-item",
                        component: newComponent.trim(),
                        ...(newZone.trim() ? { zone: newZone.trim() } : {}),
                      });
                      setNewComponent("");
                      setNewZone("");
                    }}
                  >
                    Add
                  </Button>
                </div>
              ) : null}
            </div>
          ))
        )}

        {canWrite ? (
          <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
            <label className="grid gap-1 text-sm font-medium">
              New inspection title
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Walkaround — 2021 Civic"
                disabled={pending}
                className="h-9 w-56"
              />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              Checklist
              <select
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
                disabled={pending}
                className="h-[var(--control-height)] rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Blank</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
            </label>
            <Button
              size="sm"
              disabled={pending || title.trim().length < 2}
              onClick={async () => {
                await post("/inspections", {
                  title: title.trim(),
                  ...(templateId ? { templateId } : {}),
                });
                setTitle("");
              }}
            >
              Start inspection
            </Button>
          </div>
        ) : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
