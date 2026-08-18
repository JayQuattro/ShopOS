import { describe, expect, it } from "vitest";

import {
  canTransitionServiceCall,
  InvalidServiceCallTransition,
  isServiceCallTerminal,
  type ServiceCallStatus,
} from "./service-call-state-machine";

describe("service call state machine", () => {
  const FORWARD_PATH: ServiceCallStatus[] = [
    "REQUESTED",
    "DISPATCHED",
    "EN_ROUTE",
    "ON_SCENE",
    "COMPLETED",
  ];

  it("allows every step of the happy dispatch path", () => {
    for (let i = 0; i < FORWARD_PATH.length - 1; i++) {
      expect(canTransitionServiceCall(FORWARD_PATH[i]!, FORWARD_PATH[i + 1]!)).toBe(true);
    }
  });

  it("allows cancellation only before the technician is on scene", () => {
    expect(canTransitionServiceCall("REQUESTED", "CANCELLED")).toBe(true);
    expect(canTransitionServiceCall("DISPATCHED", "CANCELLED")).toBe(true);
    expect(canTransitionServiceCall("EN_ROUTE", "CANCELLED")).toBe(true);
    expect(canTransitionServiceCall("ON_SCENE", "CANCELLED")).toBe(false);
  });

  it("rejects skipping dispatch stages", () => {
    expect(canTransitionServiceCall("REQUESTED", "EN_ROUTE")).toBe(false);
    expect(canTransitionServiceCall("REQUESTED", "ON_SCENE")).toBe(false);
    expect(canTransitionServiceCall("DISPATCHED", "COMPLETED")).toBe(false);
  });

  it("treats completed and cancelled as terminal", () => {
    expect(canTransitionServiceCall("COMPLETED", "REQUESTED")).toBe(false);
    expect(canTransitionServiceCall("CANCELLED", "DISPATCHED")).toBe(false);
    expect(isServiceCallTerminal("COMPLETED")).toBe(true);
    expect(isServiceCallTerminal("CANCELLED")).toBe(true);
    expect(isServiceCallTerminal("ON_SCENE")).toBe(false);
  });

  it("carries the from/to states on the error", () => {
    const error = new InvalidServiceCallTransition("COMPLETED", "DISPATCHED");
    expect(error.from).toBe("COMPLETED");
    expect(error.to).toBe("DISPATCHED");
    expect(error.message).toContain("COMPLETED");
  });
});
