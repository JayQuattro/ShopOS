/**
 * Humanizes a persisted token (enum value or code) for display, sentence-cased:
 * `READY_FOR_PICKUP` → "Ready for pickup", `VEHICLE` → "Vehicle".
 */
export function humanizeToken(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .split(/[_\s-]+/)
    .filter(Boolean)
    .join(" ");
  if (normalized.length === 0) return value;
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}
