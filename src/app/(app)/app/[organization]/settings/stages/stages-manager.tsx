"use client";

import { useState } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Stage = {
  id: string;
  key: string;
  label: string;
  colorHint: string | null;
  sortOrder: number;
};

/** CRUD for the org's board columns. */
export function StagesManager({
  organizationId,
  initialStages,
}: {
  organizationId: string;
  initialStages: ReadonlyArray<Stage>;
}) {
  const [stages, setStages] = useState(initialStages);
  const [label, setLabel] = useState("");
  const [colorHint, setColorHint] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch(`/api/organizations/${organizationId}/board-stages`);
    if (res.ok) setStages((await res.json()).stages ?? []);
  }

  async function post(body: Record<string, unknown>) {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/organizations/${organizationId}/board-stages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const messages: Record<string, string> = {
          duplicate_key: "A stage with that key already exists.",
          invalid_key: "Keys are lowercase letters, numbers, and dashes.",
          invalid_label: "Give the stage a name.",
        };
        throw new Error(messages[data.error ?? ""] ?? "Could not save the stage.");
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the stage.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Columns</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {stages.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No custom stages — the board uses its built-in columns (checked in, in the bay, on the
            lift, test drive, waiting on parts, ready for pickup). Add your own below and the board
            switches to them.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border/60">
            {stages.map((stage) => (
              <li
                key={stage.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
              >
                <span>
                  <span className="font-medium">{stage.label}</span>{" "}
                  <span className="font-mono text-xs text-muted-foreground">{stage.key}</span>
                  {stage.colorHint ? (
                    <span
                      className="ml-2 inline-block size-3 rounded-full border border-border align-middle"
                      style={{ backgroundColor: stage.colorHint }}
                      aria-label={`color ${stage.colorHint}`}
                    />
                  ) : null}
                </span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => void post({ action: "deactivate", stageId: stage.id })}
                  className="rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
          <label className="grid gap-1 text-sm font-medium">
            New stage
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Waiting on customer"
              disabled={pending}
              className="h-9 w-56"
            />
          </label>
          <label className="grid gap-1 text-sm font-medium">
            Color (optional)
            <Input
              value={colorHint}
              onChange={(e) => setColorHint(e.target.value)}
              placeholder="#6366f1"
              disabled={pending}
              className="h-9 w-28 font-mono"
            />
          </label>
          <button
            type="button"
            disabled={pending || label.trim().length < 1}
            onClick={async () => {
              await post({
                action: "create",
                label: label.trim(),
                ...(colorHint.trim() ? { colorHint: colorHint.trim() } : {}),
              });
              setLabel("");
              setColorHint("");
            }}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {pending ? "Saving…" : "Add stage"}
          </button>
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
