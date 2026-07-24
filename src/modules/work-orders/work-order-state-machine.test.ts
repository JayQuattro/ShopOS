import { describe, expect, it } from "vitest";

import {
  canTransition,
  InvalidStatusTransition,
  isTerminal,
  type WorkOrderStatus,
} from "@/modules/work-orders/work-order-state-machine";

describe("work-order state machine", () => {
  const forwardPath: WorkOrderStatus[] = [
    "DRAFT",
    "ESTIMATING",
    "AWAITING_AUTHORIZATION",
    "AUTHORIZED",
    "IN_PROGRESS",
    "COMPLETED",
    "INVOICED",
    "CLOSED",
  ];

  it("allows the full forward path", () => {
    for (let i = 0; i < forwardPath.length - 1; i++) {
      expect(canTransition(forwardPath[i]!, forwardPath[i + 1]!)).toBe(true);
    }
  });

  it("allows BLOCKED from IN_PROGRESS and back", () => {
    expect(canTransition("IN_PROGRESS", "BLOCKED")).toBe(true);
    expect(canTransition("BLOCKED", "IN_PROGRESS")).toBe(true);
  });

  it("allows CANCELLED from any non-terminal state", () => {
    const nonTerminal: WorkOrderStatus[] = [
      "DRAFT",
      "ESTIMATING",
      "AWAITING_AUTHORIZATION",
      "AUTHORIZED",
      "IN_PROGRESS",
      "BLOCKED",
      "COMPLETED",
    ];
    for (const status of nonTerminal) {
      expect(canTransition(status, "CANCELLED")).toBe(true);
    }
  });

  it("denies transitions out of terminal states", () => {
    expect(canTransition("CLOSED", "DRAFT")).toBe(false);
    expect(canTransition("CANCELLED", "DRAFT")).toBe(false);
  });

  it("denies skipping states (e.g. DRAFT directly to IN_PROGRESS)", () => {
    expect(canTransition("DRAFT", "IN_PROGRESS")).toBe(false);
    expect(canTransition("DRAFT", "COMPLETED")).toBe(false);
    expect(canTransition("ESTIMATING", "IN_PROGRESS")).toBe(false);
  });

  it("allows ESTIMATING back to DRAFT (rework)", () => {
    expect(canTransition("ESTIMATING", "DRAFT")).toBe(true);
  });

  it("isTerminal identifies CLOSED and CANCELLED", () => {
    expect(isTerminal("CLOSED")).toBe(true);
    expect(isTerminal("CANCELLED")).toBe(true);
    expect(isTerminal("IN_PROGRESS")).toBe(false);
  });

  it("InvalidStatusTransition is a typed error", () => {
    const error = new InvalidStatusTransition("CLOSED", "DRAFT");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("InvalidStatusTransition");
    expect(error.from).toBe("CLOSED");
    expect(error.to).toBe("DRAFT");
  });
});
