"use client";

import { useState } from "react";
import { Check, Printer, Settings2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PAPER_SIZES } from "@/modules/organizations/paper-size";

/**
 * Print controls: the print dialog plus a compact gear menu for paper-size
 * overrides (reloads with ?paper=). Hidden from the printed page.
 */
export function PrintButton({ paper }: { paper?: string }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const selected = paper ?? "LETTER";
  const active = PAPER_SIZES.find((size) => size.value === selected);

  function changePaper(next: string) {
    const url = new URL(window.location.href);
    const params = new URLSearchParams(url.search);
    params.set("paper", next);
    window.location.assign(`${url.pathname}?${params.toString()}`);
  }

  return (
    <div className="fixed top-4 right-4 flex items-center gap-2 print:hidden">
      <div className="relative">
        <Button
          variant="outline"
          size="icon"
          aria-label={`Paper size: ${active?.label ?? "Letter"}. Change paper size.`}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <Settings2 aria-hidden className="size-4" />
        </Button>
        {menuOpen ? (
          <div className="absolute right-0 top-11 z-10 w-52 rounded-md border border-neutral-200 bg-white p-1 shadow-md">
            <p className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Paper size
            </p>
            {PAPER_SIZES.map((size) => (
              <button
                key={size.value}
                type="button"
                onClick={() => changePaper(size.value)}
                className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-neutral-100"
              >
                <span>
                  <span className="block">{size.label.split(" (")[0]}</span>
                  <span className="block text-xs text-neutral-500">
                    {size.label.match(/\((.*)\)/)?.[1] ?? ""}
                  </span>
                </span>
                {size.value === selected ? (
                  <Check aria-hidden className="size-4 text-neutral-900" />
                ) : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <Button onClick={() => window.print()}>
        <Printer aria-hidden className="size-4" />
        Print
      </Button>
    </div>
  );
}
