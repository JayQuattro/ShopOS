export const themePreferences = ["system", "light", "dark", "warm", "dusk"] as const;
export const resolvedThemes = ["light", "dark", "warm", "dusk"] as const;

export type ThemePreference = (typeof themePreferences)[number];
export type ResolvedTheme = (typeof resolvedThemes)[number];

export const DEFAULT_THEME_PREFERENCE: ThemePreference = "light";
export const THEME_STORAGE_KEY = "shopos-theme";

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === "string" && themePreferences.includes(value as ThemePreference);
}

export function resolveThemePreference(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (preference === "system") {
    return systemPrefersDark ? "dark" : "light";
  }

  return preference;
}

export const themeBootstrapScript = `(() => {
  const allowed = ["system", "light", "dark", "warm", "dusk"];
  const fallback = "light";
  let preference = fallback;
  try {
    const stored = localStorage.getItem("${THEME_STORAGE_KEY}");
    if (stored && allowed.includes(stored)) preference = stored;
  } catch {}
  const dark = matchMedia("(prefers-color-scheme: dark)").matches;
  const resolved = preference === "system" ? (dark ? "dark" : "light") : preference;
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.dataset.themePreference = preference;
  root.style.colorScheme = resolved === "dark" || resolved === "dusk" ? "dark" : "light";
})();`;
