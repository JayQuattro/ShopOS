"use client";

import { Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PAPER_SIZES } from "@/modules/organizations/paper-size";

/**
 * Print controls: paper-size override (reloads with ?paper=) and the print
 * dialog. Hidden from the printed page via Tailwind print variants.
 */
export function PrintButton({ paper }: { paper?: string }) {
  function changePaper(next: string) {
    const url = new URL(window.location.href);
    url.searchParams.set("paper", next);
    window.location.href = url.toString();
  }

  return (
    <div className="fixed top-4 right-4 flex items-center gap-2 print:hidden">
      <label className="flex items-center gap-1 text-sm text-neutral-600">
        Paper
        <select
          value={paper ?? "LETTER"}
          onChange={(event) => changePaper(event.target.value)}
          className="h-9 rounded-md border border-neutral-300 bg-white px-2 text-sm"
          aria-label="Paper size"
        >
          {PAPER_SIZES.map((size) => (
            <option key={size.value} value={size.value}>
              {size.label}
            </option>
          ))}
        </select>
      </label>
      <Button onClick={() => window.print()}>
        <Printer aria-hidden className="size-4" />
        Print
      </Button>
    </div>
  );
}
