import { getRequestConfig } from "next-intl/server";

import { DEFAULT_LOCALE, isLocale } from "@/i18n/routing";

/**
 * Loads the ICU message catalogs for the requested locale. Called by next-intl
 * on every request. Falls back to en-US when the locale is missing or
 * unsupported (ADR 0010 fallback chain).
 */
export default getRequestConfig(async ({ locale }) => {
  const resolvedLocale = typeof locale === "string" && isLocale(locale) ? locale : DEFAULT_LOCALE;

  const messages = (await import(`../messages/${resolvedLocale}.json`)).default;

  return {
    locale: resolvedLocale,
    messages,
  };
});
