export type ServiceCallStatus =
  "REQUESTED" | "DISPATCHED" | "EN_ROUTE" | "ON_SCENE" | "COMPLETED" | "CANCELLED";

/**
 * Valid transitions for the roadside service-call state machine.
 *
 * REQUESTED → DISPATCHED → EN_ROUTE → ON_SCENE → COMPLETED
 * Cancellation is reachable while the technician has not arrived on scene;
 * after ON_SCENE the call either completes or stays open.
 */
const VALID_TRANSITIONS: ReadonlyMap<ServiceCallStatus, ReadonlySet<ServiceCallStatus>> = new Map([
  ["REQUESTED", new Set(["DISPATCHED", "CANCELLED"])],
  ["DISPATCHED", new Set(["EN_ROUTE", "CANCELLED"])],
  ["EN_ROUTE", new Set(["ON_SCENE", "CANCELLED"])],
  ["ON_SCENE", new Set(["COMPLETED"])],
  ["COMPLETED", new Set()],
  ["CANCELLED", new Set()],
]);

export function canTransitionServiceCall(from: ServiceCallStatus, to: ServiceCallStatus): boolean {
  const allowed = VALID_TRANSITIONS.get(from);
  return allowed?.has(to) ?? false;
}

export function isServiceCallTerminal(status: ServiceCallStatus): boolean {
  return status === "COMPLETED" || status === "CANCELLED";
}

export class InvalidServiceCallTransition extends Error {
  constructor(
    public readonly from: ServiceCallStatus,
    public readonly to: ServiceCallStatus,
  ) {
    super(`Cannot transition service call from ${from} to ${to}.`);
    this.name = "InvalidServiceCallTransition";
  }
}
