"use client";

import { Maximize, Minimize } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useDensityPreference, setDensityPreference } from "@/components/shopos/theme/theme-store";

/**
 * Compact/comfortable density toggle for the shell header. Cycles between the
 * two density modes, persisting the preference via the theme store.
 */
export function DensityToggle() {
  const density = useDensityPreference();
  const isCompact = density === "compact";

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setDensityPreference(isCompact ? "comfortable" : "compact")}
      aria-label={isCompact ? "Switch to comfortable density" : "Switch to compact density"}
      title={isCompact ? "Comfortable density" : "Compact density"}
    >
      {isCompact ? <Maximize className="size-4" /> : <Minimize className="size-4" />}
    </Button>
  );
}
