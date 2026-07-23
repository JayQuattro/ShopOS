import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

import { wcagContrast } from "culori";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_THEME_PREFERENCE,
  isThemePreference,
  resolveThemePreference,
  themeBootstrapScript,
  themePreferences,
} from "@/components/shopos/theme/theme";

const styles = readFileSync(new URL("../../../app/styles.css", import.meta.url), "utf8");

const requiredColorTokens = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "destructive-foreground",
  "border",
  "input",
  "ring",
  "success",
  "success-foreground",
  "warning",
  "warning-foreground",
  "info",
  "info-foreground",
  "status-success-background",
  "status-success-foreground",
  "status-warning-background",
  "status-warning-foreground",
  "status-destructive-background",
  "status-destructive-foreground",
  "status-neutral-background",
  "status-neutral-foreground",
  "sidebar",
  "sidebar-foreground",
  "sidebar-primary",
  "sidebar-primary-foreground",
  "sidebar-accent",
  "sidebar-accent-foreground",
  "sidebar-border",
  "sidebar-ring",
  "chart-1",
  "chart-2",
  "chart-3",
  "chart-4",
  "chart-5",
] as const;

const contrastPairs = [
  ["background", "foreground"],
  ["card", "card-foreground"],
  ["popover", "popover-foreground"],
  ["primary", "primary-foreground"],
  ["secondary", "secondary-foreground"],
  ["muted", "muted-foreground"],
  ["accent", "accent-foreground"],
  ["destructive", "destructive-foreground"],
  ["success", "success-foreground"],
  ["warning", "warning-foreground"],
  ["info", "info-foreground"],
  ["status-success-background", "status-success-foreground"],
  ["status-warning-background", "status-warning-foreground"],
  ["status-destructive-background", "status-destructive-foreground"],
  ["status-neutral-background", "status-neutral-foreground"],
  ["sidebar", "sidebar-foreground"],
  ["sidebar-primary", "sidebar-primary-foreground"],
  ["sidebar-accent", "sidebar-accent-foreground"],
] as const;

function getThemeBlock(theme: "warm" | "light" | "dark" | "dusk") {
  const selector =
    theme === "warm"
      ? String.raw`:root,\s*:root\[data-theme="warm"\]`
      : String.raw`:root\[data-theme="${theme}"\]`;
  const match = styles.match(new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\n\\}`));

  if (!match?.[1]) {
    throw new Error(`Theme block not found for ${theme}`);
  }

  return match[1];
}

function getToken(block: string, token: string) {
  const match = block.match(new RegExp(`--${token}:\\s*([^;]+);`));

  if (!match?.[1]) {
    throw new Error(`Token --${token} not found`);
  }

  return match[1].trim();
}

describe("theme contract", () => {
  it("recognizes only supported preferences", () => {
    for (const preference of themePreferences) {
      expect(isThemePreference(preference)).toBe(true);
    }

    expect(isThemePreference("contrast")).toBe(false);
    expect(isThemePreference(null)).toBe(false);
  });

  it("resolves System without changing explicit presets", () => {
    expect(resolveThemePreference("system", false)).toBe("light");
    expect(resolveThemePreference("system", true)).toBe("dark");
    expect(resolveThemePreference("warm", true)).toBe("warm");
    expect(resolveThemePreference("dusk", false)).toBe("dusk");
  });

  it.each(["warm", "light", "dark", "dusk"] as const)(
    "%s defines the complete semantic color contract",
    (theme) => {
      const block = getThemeBlock(theme);

      for (const token of requiredColorTokens) {
        expect(getToken(block, token)).toMatch(/^oklch\(/);
      }
    },
  );

  it.each(["warm", "light", "dark", "dusk"] as const)(
    "%s meets AA contrast for representative text pairs",
    (theme) => {
      const block = getThemeBlock(theme);

      for (const [background, foreground] of contrastPairs) {
        const ratio = wcagContrast(getToken(block, background), getToken(block, foreground));
        expect(
          ratio,
          `${theme}: --${foreground} on --${background} has ${ratio.toFixed(2)}:1 contrast`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    },
  );
});

describe("first-render theme bootstrap", () => {
  it.each([
    { stored: null, dark: false, theme: DEFAULT_THEME_PREFERENCE, scheme: "light" },
    { stored: "dusk", dark: false, theme: "dusk", scheme: "dark" },
    { stored: "system", dark: true, theme: "dark", scheme: "dark" },
    { stored: "not-a-theme", dark: true, theme: DEFAULT_THEME_PREFERENCE, scheme: "light" },
  ])("applies $theme before hydration", ({ stored, dark, theme, scheme }) => {
    const documentElement = {
      dataset: {} as Record<string, string>,
      style: {} as Record<string, string>,
    };

    runInNewContext(themeBootstrapScript, {
      document: { documentElement },
      localStorage: { getItem: () => stored },
      matchMedia: () => ({ matches: dark }),
    });

    expect(documentElement.dataset.theme).toBe(theme);
    expect(documentElement.style.colorScheme).toBe(scheme);
  });
});
