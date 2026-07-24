export type WorkOrderStatus =
  | "DRAFT"
  | "ESTIMATING"
  | "AWAITING_AUTHORIZATION"
  | "AUTHORIZED"
  | "IN_PROGRESS"
  | "BLOCKED"
  | "COMPLETED"
  | "INVOICED"
  | "CLOSED"
  | "CANCELLED";

/**
 * The valid forward transitions for the work-order state machine.
 *
 * DRAFT → ESTIMATING → AWAITING_AUTHORIZATION → AUTHORIZED → IN_PROGRESS → COMPLETED → INVOICED → CLOSED
 * Any non-terminal state → CANCELLED (terminal).
 * BLOCKED is a temporary state: IN_PROGRESS ↔ BLOCKED.
 *
 * Based on docs/domain-model.md: "draft, estimating, awaiting_authorization,
 * authorized, in_progress, blocked, completed, invoiced, and closed, with
 * cancelled as a terminal alternative."
 */
const VALID_TRANSITIONS: ReadonlyMap<WorkOrderStatus, ReadonlySet<WorkOrderStatus>> = new Map([
  ["DRAFT", new Set(["ESTIMATING", "CANCELLED"])],
  ["ESTIMATING", new Set(["AWAITING_AUTHORIZATION", "DRAFT", "CANCELLED"])],
  ["AWAITING_AUTHORIZATION", new Set(["AUTHORIZED", "ESTIMATING", "CANCELLED"])],
  ["AUTHORIZED", new Set(["IN_PROGRESS", "CANCELLED"])],
  ["IN_PROGRESS", new Set(["BLOCKED", "COMPLETED", "CANCELLED"])],
  ["BLOCKED", new Set(["IN_PROGRESS", "CANCELLED"])],
  ["COMPLETED", new Set(["INVOICED", "CANCELLED"])],
  ["INVOICED", new Set(["CLOSED"])],
  ["CLOSED", new Set()],
  ["CANCELLED", new Set()],
]);

export function canTransition(from: WorkOrderStatus, to: WorkOrderStatus): boolean {
  const allowed = VALID_TRANSITIONS.get(from);
  return allowed?.has(to) ?? false;
}

export function isTerminal(status: WorkOrderStatus): boolean {
  return status === "CLOSED" || status === "CANCELLED";
}

export class InvalidStatusTransition extends Error {
  constructor(
    public readonly from: WorkOrderStatus,
    public readonly to: WorkOrderStatus,
  ) {
    super(`Cannot transition work order from ${from} to ${to}.`);
    this.name = "InvalidStatusTransition";
  }
}
