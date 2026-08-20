"use client";

import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Plus, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/i18n/formatters";
import { humanizeToken } from "@/lib/labels";
import { cn } from "@/lib/utils";

export type EditorLine = Readonly<{
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
}>;

type Group = {
  key: string;
  label: string | null;
  lines: EditorLine[];
};

const GROUP_PREFIX = "group:";
const DROP_PREFIX = "drop:";

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function groupDragId(key: string) {
  return `${GROUP_PREFIX}${key}`;
}
function groupDropId(key: string) {
  return `${DROP_PREFIX}${key}`;
}

function buildGroups(lines: readonly EditorLine[]): Group[] {
  const map = new Map<string, Group>();
  for (const line of lines) {
    const group = map.get(line.serviceGroupKey) ?? {
      key: line.serviceGroupKey,
      label: line.serviceGroupLabel,
      lines: [],
    };
    group.lines.push(line);
    map.set(line.serviceGroupKey, group);
  }
  return [...map.values()];
}

function groupLabel(group: Group): string {
  return group.label ?? (group.key === "general" ? "Other items" : humanizeToken(group.key));
}

/**
 * Touch-first draft-line editor for an estimate revision. Lines drag between
 * job groups and reorder inside them; groups themselves drag to reorder and
 * rename inline. Every change persists immediately — the drag ends with a
 * PUT of the full ordered line list.
 */
export function EstimateLinesEditor({
  revisionId,
  currency,
  lines,
  pendingGroups,
  onPendingLabelChange,
  onRemovePending,
  onChanged,
  onRequestAddToGroup,
}: {
  revisionId: string;
  currency: string;
  lines: readonly EditorLine[];
  /** Job groups created ahead of their first line; local until a line lands. */
  pendingGroups: ReadonlyArray<Readonly<{ key: string; label: string }>>;
  onPendingLabelChange: (key: string, label: string) => void;
  onRemovePending: (key: string) => void;
  onChanged: () => Promise<void> | void;
  onRequestAddToGroup: (label: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeLineId, setActiveLineId] = useState<string | null>(null);
  const [renamingKey, setRenamingKey] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");

  const sensors = useSensors(
    // Distance-constrained pointer sensor: taps and buttons still work, drags
    // need a small deliberate move — right for touch and mouse alike.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const groups = useMemo(() => buildGroups(lines), [lines]);
  const groupOrder = useMemo(() => groups.map((group) => group.key), [groups]);
  // A pending group disappears from the pending list the moment a real group
  // with the same name exists (a line landed in it).
  const shownPending = useMemo(() => {
    const realized = new Set(groups.map((group) => groupLabel(group)));
    return pendingGroups.filter(
      (entry) => entry.label.trim().length === 0 || !realized.has(entry.label.trim()),
    );
  }, [pendingGroups, groups]);

  async function persistOrder(nextGroups: Group[]) {
    setBusy(true);
    setError(null);
    try {
      const items = nextGroups.flatMap((group) =>
        group.lines.map((line) => ({
          lineId: line.id,
          serviceGroupKey: group.key,
          ...(group.label ? { serviceGroupLabel: group.label } : {}),
        })),
      );
      const res = await fetch(`/api/estimate-revisions/${revisionId}/lines/order`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      if (!res.ok) throw new Error("Could not save the new arrangement.");
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the new arrangement.");
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  function handleDragStart(event: DragStartEvent) {
    const id = String(event.active.id);
    if (!id.startsWith(GROUP_PREFIX)) setActiveLineId(id);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveLineId(null);
    const activeId = String(event.active.id);
    const over = event.over;
    if (!over) return;
    const overId = String(over.id);

    // Group reorder: move the whole block of lines.
    if (activeId.startsWith(GROUP_PREFIX)) {
      if (!overId.startsWith(GROUP_PREFIX) || activeId === overId) return;
      const fromKey = activeId.slice(GROUP_PREFIX.length);
      const toKey = overId.slice(GROUP_PREFIX.length);
      const fromIndex = groups.findIndex((group) => group.key === fromKey);
      const toIndex = groups.findIndex((group) => group.key === toKey);
      if (fromIndex < 0 || toIndex < 0) return;
      void persistOrder(arrayMove(groups, fromIndex, toIndex));
      return;
    }

    // Line move/reorder: resolve the destination group and insertion point.
    let targetKey: string | null = null;
    let targetLabel: string | null = null;
    let overLineId: string | null = null;
    if (overId.startsWith(DROP_PREFIX)) {
      const raw = overId.slice(DROP_PREFIX.length);
      if (raw.startsWith("pending:")) {
        // A fresh, still-empty job group: dropping names it.
        const pending = pendingGroups.find((entry) => entry.key === raw.slice("pending:".length));
        if (!pending || !pending.label.trim()) return;
        targetKey = slugify(pending.label);
        targetLabel = pending.label.trim();
      } else {
        targetKey = raw;
      }
    } else {
      const overLine = lines.find((line) => line.id === overId);
      if (overLine) {
        targetKey = overLine.serviceGroupKey;
        overLineId = overLine.id;
      }
    }
    if (!targetKey) return;

    const activeLine = lines.find((line) => line.id === activeId);
    if (!activeLine) return;
    if (activeLine.id === overLineId) return;

    const nextGroups = groups.map((group) => ({
      ...group,
      lines: group.lines.filter((line) => line.id !== activeLine.id),
    }));
    let targetGroup = nextGroups.find((group) => group.key === targetKey);
    if (!targetGroup) {
      if (!targetLabel) return;
      targetGroup = { key: targetKey, label: targetLabel, lines: [] };
      nextGroups.push(targetGroup);
    }
    const insertAt = overLineId
      ? targetGroup.lines.findIndex((line) => line.id === overLineId)
      : targetGroup.lines.length;
    targetGroup.lines.splice(insertAt < 0 ? targetGroup.lines.length : insertAt, 0, activeLine);
    void persistOrder(nextGroups);
  }

  async function deleteLine(lineId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/estimate-revisions/${revisionId}/lines?lineId=${lineId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Could not remove the line.");
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove the line.");
    } finally {
      setBusy(false);
    }
  }

  async function renameGroup(group: Group) {
    const label = renameText.trim();
    setRenamingKey(null);
    if (!label || label === group.label) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/estimate-revisions/${revisionId}/groups`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: group.key, label }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          body.error === "group_name_conflict"
            ? "Another job already uses a similar name."
            : "Could not rename the job.",
        );
      }
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not rename the job.");
    } finally {
      setBusy(false);
    }
  }

  function ungroup(group: Group) {
    if (group.key === "general") return;
    const others = groups.filter((entry) => entry.key !== group.key && entry.key !== "general");
    const general = groups.find((entry) => entry.key === "general");
    const mergedGeneral: Group = {
      key: "general",
      label: null,
      lines: [...(general?.lines ?? []), ...group.lines],
    };
    void persistOrder([...others, mergedGeneral]);
  }

  const activeLine = activeLineId ? lines.find((line) => line.id === activeLineId) : null;

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveLineId(null)}
      >
        <SortableContext
          items={groupOrder.map((key) => groupDragId(key))}
          strategy={verticalListSortingStrategy}
        >
          <div className="flex flex-col gap-3">
            {groups.map((group) => (
              <GroupCard
                key={group.key}
                group={group}
                currency={currency}
                busy={busy}
                renaming={renamingKey === group.key}
                renameText={renameText}
                onRenameTextChange={setRenameText}
                onStartRename={() => {
                  setRenamingKey(group.key);
                  setRenameText(groupLabel(group));
                }}
                onRenameSubmit={() => void renameGroup(group)}
                onRenameCancel={() => setRenamingKey(null)}
                onUngroup={() => void ungroup(group)}
                onAddToGroup={() => onRequestAddToGroup(groupLabel(group))}
                onDeleteLine={(lineId) => void deleteLine(lineId)}
              />
            ))}
            {shownPending.map((entry) => (
              <PendingGroupCard
                key={entry.key}
                entry={entry}
                onLabelChange={onPendingLabelChange}
                onRemove={() => onRemovePending(entry.key)}
                onAddToGroup={() => onRequestAddToGroup(entry.label.trim())}
              />
            ))}
          </div>
        </SortableContext>

        <DragOverlay>
          {activeLine ? (
            <div className="rounded-md border border-primary bg-card px-3 py-2 text-sm shadow-lg">
              {activeLine.description}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <p className="text-xs text-muted-foreground">
        Drag the handle to move a line between jobs or reorder it. Drag a job&apos;s header to
        reorder jobs.
      </p>
    </div>
  );
}

function GroupCard({
  group,
  currency,
  busy,
  renaming,
  renameText,
  onRenameTextChange,
  onStartRename,
  onRenameSubmit,
  onRenameCancel,
  onUngroup,
  onAddToGroup,
  onDeleteLine,
}: {
  group: Group;
  currency: string;
  busy: boolean;
  renaming: boolean;
  renameText: string;
  onRenameTextChange: (value: string) => void;
  onStartRename: () => void;
  onRenameSubmit: () => void;
  onRenameCancel: () => void;
  onUngroup: () => void;
  onAddToGroup: () => void;
  onDeleteLine: (lineId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: groupDragId(group.key),
  });
  // Container drop target so lines can land in an empty group.
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: groupDropId(group.key) });
  const subtotal = group.lines.reduce((sum, line) => sum + Number(line.totalMinor), 0);

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "rounded-lg border border-border bg-card",
        isDragging && "opacity-70 ring-2 ring-primary/40",
      )}
      data-testid={`job-${group.key}`}
    >
      <div
        className={cn(
          "flex items-center gap-2 border-b border-border px-2 py-2",
          group.key === "general" ? "bg-muted/30" : "bg-muted/50",
        )}
      >
        <button
          type="button"
          aria-label={`Reorder job ${groupLabel(group)}`}
          className="flex size-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground hover:bg-muted active:cursor-grabbing"
          disabled={busy}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" aria-hidden />
        </button>
        {renaming ? (
          <input
            autoFocus
            value={renameText}
            onChange={(e) => onRenameTextChange(e.target.value)}
            onBlur={onRenameSubmit}
            onKeyDown={(e) => {
              if (e.key === "Enter") onRenameSubmit();
              if (e.key === "Escape") onRenameCancel();
            }}
            className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm font-semibold"
            aria-label="Job name"
          />
        ) : (
          <button
            type="button"
            onClick={onStartRename}
            className="min-h-9 flex-1 rounded-md px-2 text-left text-sm font-semibold hover:bg-muted/60"
            title="Rename this job"
          >
            {groupLabel(group)}
          </button>
        )}
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {formatMoney(subtotal, currency, "en-US")}
        </span>
        <button
          type="button"
          onClick={onAddToGroup}
          disabled={busy}
          className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          title="Add a line to this job"
          aria-label={`Add a line to ${groupLabel(group)}`}
        >
          <Plus className="size-4" aria-hidden />
        </button>
        {group.key !== "general" ? (
          <button
            type="button"
            onClick={onUngroup}
            disabled={busy}
            className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Ungroup — lines move to Other items"
            aria-label={`Ungroup ${groupLabel(group)}`}
          >
            <X className="size-4" aria-hidden />
          </button>
        ) : null}
      </div>

      <SortableContext
        id={group.key}
        items={group.lines.map((line) => line.id)}
        strategy={verticalListSortingStrategy}
      >
        <div
          ref={setDropRef}
          className={cn(
            "flex flex-col p-1.5",
            isOver && "rounded-b-lg bg-primary/5 ring-1 ring-primary/30 ring-inset",
          )}
        >
          {group.lines.map((line) => (
            <LineRow
              key={line.id}
              line={line}
              currency={currency}
              busy={busy}
              onDelete={() => onDeleteLine(line.id)}
            />
          ))}
          <div className="rounded-md px-2 py-1 text-center text-xs text-muted-foreground/60">
            {group.lines.length === 0 ? "Empty job — drag lines here" : ""}
          </div>
        </div>
      </SortableContext>
    </div>
  );
}

function LineRow({
  line,
  currency,
  busy,
  onDelete,
}: {
  line: EditorLine;
  currency: string;
  busy: boolean;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: line.id,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex items-center gap-2 rounded-md px-1 py-1.5 hover:bg-muted/40",
        isDragging && "opacity-40",
      )}
    >
      <button
        type="button"
        aria-label={`Move ${line.description}`}
        className="flex size-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground hover:bg-muted active:cursor-grabbing"
        disabled={busy}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" aria-hidden />
      </button>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">
          {line.description}
          {line.optionGroupLabel ? (
            <span className="ml-2 rounded-full bg-secondary px-2 py-0.5 text-[10px] text-secondary-foreground">
              option · {line.optionGroupLabel}
            </span>
          ) : null}
        </p>
        <p className="text-xs text-muted-foreground">
          {Number(line.unitPriceMinor) < 0 ? "credit" : line.kind.toLowerCase()} ·{" "}
          {(line.quantityMilli / 1000).toFixed(1)} ×{" "}
          {formatMoney(Number(line.unitPriceMinor), currency, "en-US")}
        </p>
      </div>
      <span className="shrink-0 font-mono text-sm tabular-nums">
        {formatMoney(Number(line.totalMinor), currency, "en-US")}
      </span>
      <button
        type="button"
        onClick={onDelete}
        disabled={busy}
        aria-label={`Remove ${line.description}`}
        className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
      >
        <Trash2 className="size-4" aria-hidden />
      </button>
    </div>
  );
}

function PendingGroupCard({
  entry,
  onLabelChange,
  onRemove,
  onAddToGroup,
}: {
  entry: Readonly<{ key: string; label: string }>;
  onLabelChange: (key: string, label: string) => void;
  onRemove: () => void;
  onAddToGroup: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: groupDropId(`pending:${entry.key}`) });
  const named = entry.label.trim().length > 0;

  if (!named) {
    return (
      <div className="rounded-lg border border-dashed border-border p-3">
        <div className="flex items-center gap-2">
          <input
            autoFocus
            value={entry.label}
            onChange={(e) => onLabelChange(entry.key, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            placeholder="Job name — Front brakes…"
            aria-label="New job name"
            className="h-[var(--control-height)] min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm font-medium"
          />
          <button
            type="button"
            onClick={onRemove}
            aria-label="Discard this job"
            className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          The job is saved as soon as it has a line — add one below or drag one in.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-dashed border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-2 py-2">
        <p className="min-h-9 flex-1 px-2 text-sm font-semibold leading-9">{entry.label.trim()}</p>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Discard ${entry.label.trim()}`}
          className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "flex flex-col items-center gap-2 p-3",
          isOver && "rounded-b-lg bg-primary/5 ring-1 ring-primary/30 ring-inset",
        )}
      >
        <p className="text-xs text-muted-foreground">New job — drag lines here, or:</p>
        <Button variant="outline" size="sm" onClick={onAddToGroup}>
          <Plus className="size-4" aria-hidden />
          Add line to this job
        </Button>
      </div>
    </div>
  );
}
