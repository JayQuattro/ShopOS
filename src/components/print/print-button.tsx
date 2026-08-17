"use client";

import { Printer } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Opens the browser print dialog for a print document. Hidden from the
 * printed page itself via Tailwind print variants.
 */
export function PrintButton() {
  return (
    <div className="fixed top-4 right-4 flex gap-2 print:hidden">
      <Button onClick={() => window.print()}>
        <Printer aria-hidden className="size-4" />
        Print
      </Button>
    </div>
  );
}
