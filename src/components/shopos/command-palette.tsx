"use client";

import { Command as CommandIcon, Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";

export type CommandAction = Readonly<{
  label: string;
  href: string;
  group: string;
}>;

export type CommandPaletteProps = Readonly<{
  actions: readonly CommandAction[];
}>;

/**
 * ⌘K-triggered command palette. Provides keyboard-accessible global navigation
 * and quick actions. Today it is a client-side filter over known navigation
 * shortcuts; full-text search indexing arrives with future modules. The palette
 * follows the design plan's "global search and command access" requirement.
 */
export function CommandPalette({ actions }: CommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    function handler(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        setOpen((previous) => !previous);
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const filtered = query
    ? actions.filter((action) => action.label.toLowerCase().includes(query.toLowerCase()))
    : actions;

  const groups = [...new Set(filtered.map((action) => action.group))];

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="gap-2"
        onClick={() => setOpen(true)}
        aria-label="Open command palette"
      >
        <Search className="size-4" />
        <span className="hidden text-muted-foreground sm:inline">Search…</span>
        <kbd className="hidden items-center gap-0.5 rounded border border-border px-1 text-xs text-muted-foreground sm:inline-flex">
          <CommandIcon className="size-3" />K
        </kbd>
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="top" className="mx-auto w-full max-w-xl rounded-b-lg">
          <SheetHeader>
            <SheetTitle className="sr-only">Command palette</SheetTitle>
            <SheetDescription className="sr-only">
              Search for pages and actions. Use arrow keys to navigate.
            </SheetDescription>
          </SheetHeader>
          <Input
            autoFocus
            placeholder="Type a command or search…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="mb-3"
          />
          <div className="flex flex-col gap-4 overflow-y-auto pb-4">
            {groups.map((group) => (
              <div key={group} className="flex flex-col gap-0.5">
                <span className="px-2 pb-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                  {group}
                </span>
                {filtered
                  .filter((action) => action.group === group)
                  .map((action) => (
                    <Link
                      key={action.href}
                      href={action.href}
                      onClick={() => {
                        setOpen(false);
                        setQuery("");
                      }}
                      className="rounded-md px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                    >
                      {action.label}
                    </Link>
                  ))}
              </div>
            ))}
            {filtered.length === 0 ? (
              <p className="px-2 py-4 text-center text-sm text-muted-foreground">
                No results for &ldquo;{query}&rdquo;
              </p>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
