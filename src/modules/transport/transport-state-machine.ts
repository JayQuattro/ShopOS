export type TransportStatus = "SCHEDULED" | "EN_ROUTE" | "COMPLETED" | "CANCELLED";

/**
 * Valid transitions for pickup/delivery transport jobs.
 *
 * SCHEDULED → EN_ROUTE → COMPLETED, with cancellation allowed until the
 * vehicle is handed over (completion).
 */
const VALID_TRANSITIONS: ReadonlyMap<TransportStatus, ReadonlySet<TransportStatus>> = new Map([
  ["SCHEDULED", new Set(["EN_ROUTE", "CANCELLED"])],
  ["EN_ROUTE", new Set(["COMPLETED", "CANCELLED"])],
  ["COMPLETED", new Set()],
  ["CANCELLED", new Set()],
]);

export function canTransitionTransport(from: TransportStatus, to: TransportStatus): boolean {
  const allowed = VALID_TRANSITIONS.get(from);
  return allowed?.has(to) ?? false;
}

export function isTransportTerminal(status: TransportStatus): boolean {
  return status === "COMPLETED" || status === "CANCELLED";
}
