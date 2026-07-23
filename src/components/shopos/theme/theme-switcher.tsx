"use client";

import { Palette } from "lucide-react";
import { useId } from "react";

import { themePreferences, type ThemePreference } from "@/components/shopos/theme/theme";
import { setThemePreference, useThemePreference } from "@/components/shopos/theme/theme-store";
import { cn } from "@/lib/utils";

const labels: Record<ThemePreference, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
  warm: "Warm",
  dusk: "Dusk",
};

export function ThemeSwitcher({ compact = false }: { compact?: boolean }) {
  const id = useId();
  const preference = useThemePreference();

  return (
    <label
      htmlFor={id}
      className={cn(
        "inline-flex min-h-[var(--control-height)] items-center gap-2 rounded-md border border-border bg-card px-3 text-sm font-semibold text-card-foreground shadow-xs",
        compact && "px-2.5",
      )}
    >
      <Palette aria-hidden="true" className="size-4 text-muted-foreground" />
      <span className={cn(compact && "sr-only")}>Appearance</span>
      <select
        id={id}
        aria-label={compact ? "Appearance" : undefined}
        className="min-h-9 cursor-pointer rounded-sm bg-transparent pr-1 text-sm font-semibold"
        value={preference}
        onChange={(event) => setThemePreference(event.target.value as ThemePreference)}
      >
        {themePreferences.map((theme) => (
          <option key={theme} value={theme}>
            {labels[theme]}
          </option>
        ))}
      </select>
    </label>
  );
}
