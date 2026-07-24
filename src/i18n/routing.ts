import { defineRouting } from "next-intl/routing";

/**
 * Canonical BCP 47 locale identifiers supported by ShopOS.
 *
 * `en-US` is the source and final fallback. `en-XA` is a pseudo-locale for
 * testing text expansion and layout in development and CI (ADR 0010).
 *
 * Additional locales are added here once their ICU catalogs are checked in and
 * validated. The locale registry is the single source of truth for negotiation.
 */
export const SUPPORTED_LOCALES = ["en-US", "en-XA"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: SupportedLocale = "en-US";

export const routing = defineRouting({
  locales: [...SUPPORTED_LOCALES],
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: "always",
});

/**
 * Returns true if a string is a supported locale.
 */
export function isLocale(value: string): value is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * Locales whose script direction is right-to-left.
 */
const RTL_LOCALES: ReadonlySet<string> = new Set(["ar", "he", "fa", "ur"]);

export function isRtl(locale: string): boolean {
  const language = locale.split("-")[0] ?? "";
  return RTL_LOCALES.has(language);
}

/**
 * Negotiates the best locale from an Accept-Language header value, applying the
 * fallback chain: exact match → parent language match → `en-US` (ADR 0010).
 */
export function negotiateLocale(acceptLanguage: string | null): SupportedLocale {
  if (!acceptLanguage) return DEFAULT_LOCALE;

  const requested = acceptLanguage
    .split(",")
    .map((part) => part.trim().split(";")[0]?.trim())
    .filter(Boolean) as string[];

  // Exact match.
  for (const candidate of requested) {
    if (isLocale(candidate)) return candidate;
  }

  // Parent language match (e.g. "en" → "en-US").
  for (const candidate of requested) {
    const parent = candidate.split("-")[0];
    const match = SUPPORTED_LOCALES.find((loc) => loc.startsWith(`${parent}-`));
    if (match) return match;
  }

  return DEFAULT_LOCALE;
}
