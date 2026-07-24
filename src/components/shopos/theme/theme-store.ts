"use client";

import { useSyncExternalStore } from "react";

import {
  DEFAULT_THEME_PREFERENCE,
  isThemePreference,
  resolveThemePreference,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from "@/components/shopos/theme/theme";

const THEME_CHANGE_EVENT = "shopos:theme-change";

function getSystemPrefersDark() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function readThemePreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : DEFAULT_THEME_PREFERENCE;
  } catch {
    return DEFAULT_THEME_PREFERENCE;
  }
}

function applyThemePreference(preference: ThemePreference) {
  const resolved = resolveThemePreference(preference, getSystemPrefersDark());
  const root = document.documentElement;

  root.dataset.theme = resolved;
  root.dataset.themePreference = preference;
  root.style.colorScheme = resolved === "dark" || resolved === "dusk" ? "dark" : "light";
}

function subscribe(listener: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");

  const handlePreferenceChange = () => {
    applyThemePreference(readThemePreference());
    listener();
  };

  window.addEventListener("storage", handlePreferenceChange);
  window.addEventListener(THEME_CHANGE_EVENT, handlePreferenceChange);
  media.addEventListener("change", handlePreferenceChange);

  applyThemePreference(readThemePreference());

  return () => {
    window.removeEventListener("storage", handlePreferenceChange);
    window.removeEventListener(THEME_CHANGE_EVENT, handlePreferenceChange);
    media.removeEventListener("change", handlePreferenceChange);
  };
}

function getSnapshot() {
  return readThemePreference();
}

function getServerSnapshot(): ThemePreference {
  return DEFAULT_THEME_PREFERENCE;
}

export function setThemePreference(preference: ThemePreference) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // A private browsing policy may deny storage; the selected theme still applies for this page.
  }

  applyThemePreference(preference);
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));

  // Persist to the server so the next server render matches (no theme flash).
  // Fire-and-forget: the preference is already applied locally.
  void persistAppearancePreference({ themePreference: preference });
}

async function persistAppearancePreference(body: {
  themePreference?: string;
  densityPreference?: string;
}): Promise<void> {
  try {
    await fetch("/api/preferences/appearance", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    // Persistence is best-effort; the local preference still applies.
  }
}

export function useThemePreference() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export type DensityPreference = "comfortable" | "compact";

const DENSITY_STORAGE_KEY = "shopos-density";
const DENSITY_CHANGE_EVENT = "shopos:density-change";

function readDensityPreference(): DensityPreference {
  try {
    const stored = window.localStorage.getItem(DENSITY_STORAGE_KEY);
    if (stored === "compact" || stored === "comfortable") return stored;
  } catch {
    // Private browsing; fall back to default.
  }
  return "comfortable";
}

function applyDensityPreference(density: DensityPreference) {
  const root = document.documentElement;
  if (density === "compact") {
    root.dataset.density = "compact";
  } else {
    delete root.dataset.density;
  }
}

export function setDensityPreference(density: DensityPreference) {
  try {
    window.localStorage.setItem(DENSITY_STORAGE_KEY, density);
  } catch {
    // Private browsing; the density still applies for this page.
  }
  applyDensityPreference(density);
  window.dispatchEvent(new Event(DENSITY_CHANGE_EVENT));
  void persistAppearancePreference({ densityPreference: density });
}

export function useDensityPreference(): DensityPreference {
  return useSyncExternalStore(
    (listener) => {
      const handler = () => listener();
      window.addEventListener("storage", handler);
      window.addEventListener(DENSITY_CHANGE_EVENT, handler);
      return () => {
        window.removeEventListener("storage", handler);
        window.removeEventListener(DENSITY_CHANGE_EVENT, handler);
      };
    },
    readDensityPreference,
    () => "comfortable" as DensityPreference,
  );
}
