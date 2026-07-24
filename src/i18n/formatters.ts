/**
 * Shared locale-aware formatters.
 *
 * All formatters take an explicit BCP 47 locale and never derive currency,
 * time zone, or units from the locale (AGENTS.md / ADR 0010). Money always uses
 * the record's ISO currency code; dates always use the record's IANA time zone.
 */

/**
 * Formats integer minor units plus an ISO currency code as a localized money
 * string. Never uses binary floating point.
 */
export function formatMoney(amountMinor: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amountMinor / 100);
}

/**
 * Formats a date (or ISO string) in the given IANA time zone.
 */
export function formatDate(
  date: Date | string,
  timeZone: string,
  locale: string,
  options?: Intl.DateTimeFormatOptions,
): string {
  const resolved = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone,
    ...options,
  }).format(resolved);
}

/**
 * Formats a date and time in the given IANA time zone.
 */
export function formatDateTime(date: Date | string, timeZone: string, locale: string): string {
  return formatDate(date, timeZone, locale, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Formats a relative time duration (e.g. "3 days ago").
 */
export function formatRelativeTime(
  date: Date | string,
  locale: string,
  now: Date = new Date(),
): string {
  const resolved = typeof date === "string" ? new Date(date) : date;
  const diffSeconds = Math.round((resolved.getTime() - now.getTime()) / 1000);

  const absDiff = Math.abs(diffSeconds);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

  if (absDiff < 60) return rtf.format(Math.round(diffSeconds), "second");
  if (absDiff < 3600) return rtf.format(Math.round(diffSeconds / 60), "minute");
  if (absDiff < 86400) return rtf.format(Math.round(diffSeconds / 3600), "hour");
  if (absDiff < 2592000) return rtf.format(Math.round(diffSeconds / 86400), "day");
  if (absDiff < 31536000) return rtf.format(Math.round(diffSeconds / 2592000), "month");
  return rtf.format(Math.round(diffSeconds / 31536000), "year");
}

/**
 * Formats a number in the given locale.
 */
export function formatNumber(value: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(value);
}

/**
 * Formats a percentage value (0-100) in the given locale.
 */
export function formatPercent(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(value / 100);
}

/**
 * Formats a list of strings using locale-aware conjunctions.
 */
export function formatList(items: readonly string[], locale: string): string {
  return new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format([...items]);
}
