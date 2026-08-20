"use client";

import { X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shopos/states";
import { cn } from "@/lib/utils";

export type WorkspaceTab = Readonly<{
  id: string;
  label: string;
  node: ReactNode;
}>;

export type WorkspaceShellProps = Readonly<{
  organizationId: string;
  tabs: readonly WorkspaceTab[];
  initialActiveId: string | null;
}>;

const MAX_TABS = 6;

/**
 * Tabbed multi-work-order workspace. Every tab stays mounted (inactive panes
 * are hidden, not unmounted) so each work order keeps its scroll position and
 * panel state while you switch between them. The tab set lives in the URL, so
 * a refresh restores exactly what was open.
 */
export function WorkspaceShell({ organizationId, tabs, initialActiveId }: WorkspaceShellProps) {
  const initialIds = useMemo(() => tabs.map((tab) => tab.id).join(","), [tabs]);
  const [openTabs, setOpenTabs] = useState<readonly { id: string; label: string }[]>(() =>
    tabs.slice(0, MAX_TABS).map(({ id, label }) => ({ id, label })),
  );
  const [activeId, setActiveId] = useState<string | null>(() => {
    const capped = tabs.slice(0, MAX_TABS);
    const requested = initialActiveId && capped.some((tab) => tab.id === initialActiveId);
    return requested ? initialActiveId : (capped[capped.length - 1]?.id ?? null);
  });

  const nodesById = useMemo(() => new Map(tabs.map((tab) => [tab.id, tab.node])), [tabs]);

  // Keep the URL in sync so refresh (and bookmarking) restores the tab set.
  useEffect(() => {
    const params = new URLSearchParams();
    if (openTabs.length > 0) {
      params.set("wo", openTabs.map((tab) => tab.id).join(","));
      if (activeId) params.set("active", activeId);
      window.history.replaceState(null, "", `?${params.toString()}`);
    } else if (initialIds.length > 0) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [openTabs, activeId, initialIds]);

  function closeTab(id: string) {
    setOpenTabs((current) => {
      const index = current.findIndex((tab) => tab.id === id);
      const next = current.filter((tab) => tab.id !== id);
      setActiveId((currentActive) => {
        if (currentActive !== id)
          return currentActive && next.some((t) => t.id === currentActive)
            ? currentActive
            : (next[Math.max(0, index - 1)]?.id ?? null);
        return next[Math.max(0, index - 1)]?.id ?? next[0]?.id ?? null;
      });
      return next;
    });
  }

  if (openTabs.length === 0) {
    return (
      <EmptyState
        title="No work orders open"
        description="Open one from the work order list, or send one here with “Open in workspace”."
        action={
          <Button variant="outline" asChild>
            <Link href={`/app/${organizationId}/work-orders`}>Go to work orders</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <div
        role="tablist"
        aria-label="Open work orders"
        className="flex gap-2 overflow-x-auto rounded-lg border border-border bg-muted/40 p-2"
      >
        {openTabs.map((tab) => {
          const active = tab.id === activeId;
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              className={cn(
                "flex items-center gap-1 rounded-full border transition-colors",
                active
                  ? "border-primary bg-primary/10"
                  : "border-transparent hover:border-border hover:bg-muted",
              )}
            >
              <button
                type="button"
                onClick={() => setActiveId(tab.id)}
                className="min-h-10 rounded-full px-4 text-sm font-medium whitespace-nowrap text-foreground"
              >
                {tab.label}
              </button>
              <button
                type="button"
                onClick={() => closeTab(tab.id)}
                aria-label={`Close ${tab.label}`}
                className="mr-1.5 flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </div>
          );
        })}
      </div>

      {openTabs.map((tab) => (
        <div key={tab.id} hidden={tab.id !== activeId}>
          {nodesById.get(tab.id) ?? null}
        </div>
      ))}
    </div>
  );
}
