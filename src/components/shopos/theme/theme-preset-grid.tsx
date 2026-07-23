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
    value: "warm",
    name: "Warm",
    description: "ShopOS default · paper, ink, and restrained clay",
  },
  {
    value: "light",
    name: "Light",
    description: "Clean neutral surfaces for bright workspaces",
  },
  {
    value: "dark",
    name: "Dark",
    description: "High-clarity charcoal for low-light work",
  },
  {
    value: "dusk",
    name: "Dusk",
    description: "A softer aubergine night palette",
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
              "group min-h-36 rounded-xl border bg-card p-4 text-left text-card-foreground shadow-xs transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:shadow-[var(--shadow-card)]",
              selected ? "border-primary ring-2 ring-primary/20" : "border-border",
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
              {selected ? <Check className="size-4 text-primary" aria-hidden="true" /> : null}
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
