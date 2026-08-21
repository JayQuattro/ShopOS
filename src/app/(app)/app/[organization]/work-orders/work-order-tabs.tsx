"use client";

import { useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

export type WorkOrderTab = Readonly<{
  id: string;
  label: string;
  content: ReactNode;
}>;

/**
 * Workflow tabs for the work order screen. Every tab's content is rendered
 * once and hidden (not unmounted) while inactive — switching is instant and
 * in-progress panel state (half-typed tasks, open estimate editors) survives.
 * The persistent context bar above carries identity, money, and status so
 * nothing critical is ever a tab away.
 */
export function WorkOrderTabs({
  tabs,
  initialTabId,
}: {
  tabs: readonly WorkOrderTab[];
  /** Opening tab — role-aware: writers land on Jobs & estimate, technicians on Work & time. */
  initialTabId?: string;
}) {
  const [activeId, setActiveId] = useState(
    initialTabId && tabs.some((tab) => tab.id === initialTabId)
      ? initialTabId
      : (tabs[0]?.id ?? ""),
  );

  return (
    <div className="flex flex-col gap-4">
      <div
        role="tablist"
        aria-label="Work order sections"
        className="flex gap-1.5 overflow-x-auto border-b border-border pb-px"
      >
        {tabs.map((tab) => {
          const active = tab.id === activeId;
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={active}
              onClick={() => setActiveId(tab.id)}
              className={cn(
                "min-h-11 rounded-t-lg border border-b-0 px-4 text-sm font-medium whitespace-nowrap transition-colors",
                active
                  ? "border-border bg-card text-foreground"
                  : "border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {tabs.map((tab) => (
        <div key={tab.id} hidden={tab.id !== activeId} className="flex flex-col gap-4">
          {tab.content}
        </div>
      ))}
    </div>
  );
}
