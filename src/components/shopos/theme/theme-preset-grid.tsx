"use client";

import { Check } from "lucide-react";

import { setThemePreference, useThemePreference } from "@/components/shopos/theme/theme-store";
import { type ThemePreference } from "@/components/shopos/theme/theme";
import { cn } from "@/lib/utils";

const presets: ReadonlyArray<{
  value: ThemePreference;
  name: string;
  description: string;
}> = [
  {
    value: "light",
    name: "Light",
    description: "ShopOS default · bright, neutral, and sharply organized",
  },
  {
    value: "dark",
    name: "Dark",
    description: "Neutral graphite with clear blue interaction cues",
  },
  {
    value: "warm",
    name: "Warm",
    description: "A softer ivory and taupe option for long workdays",
  },
  {
    value: "dusk",
    name: "Dusk",
    description: "A quieter slate-indigo option for low-light work",
  },
  {
    value: "system",
    name: "System",
    description: "Follow this device’s light or dark preference",
  },
];

export function ThemePresetGrid() {
  const preference = useThemePreference();

  return (
    <div
      className="grid gap-[var(--density-gap)] sm:grid-cols-2 xl:grid-cols-5"
      aria-label="Theme presets"
    >
      {presets.map((preset) => {
        const selected = preference === preset.value;

        return (
          <button
            key={preset.value}
            type="button"
            aria-pressed={selected}
            data-theme-preview={preset.value}
            onClick={() => setThemePreference(preset.value)}
            className={cn(
              "group min-h-36 rounded-lg border bg-card p-4 text-left text-card-foreground transition-[border-color,background-color,box-shadow] hover:border-input hover:bg-muted/35",
              selected ? "border-ring ring-2 ring-ring/20" : "border-border",
            )}
          >
            <span className="mb-4 flex gap-1" aria-hidden="true">
              {[1, 2, 3, 4].map((swatch) => (
                <span
                  key={swatch}
                  className="size-6 rounded-full border border-black/10"
                  style={{ backgroundColor: `var(--theme-preview-${swatch})` }}
                />
              ))}
            </span>
            <span className="flex items-center justify-between gap-3 font-semibold">
              {preset.name}
              {selected ? <Check className="size-4 text-link" aria-hidden="true" /> : null}
            </span>
            <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
              {preset.description}
            </span>
          </button>
        );
      })}
    </div>
  );
}
