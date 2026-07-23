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
}

export function useThemePreference() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
