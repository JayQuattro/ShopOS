import { describe, expect, it } from "vitest";

import {
  getPlanDefinition,
  isPlanKey,
  PLAN_DEFINITIONS,
  PLAN_KEYS,
  resolvePlanEntitlements,
} from "@/modules/platform/plans";

describe("plan catalog", () => {
  it("defines four plans", () => {
    expect(PLAN_KEYS).toEqual(["free", "starter", "growth", "enterprise"]);
  });

  it("every plan has all six entitlement keys", () => {
    const expectedKeys = [
      "members.max",
      "locations.max",
      "work_orders.max_active",
      "integrations.custom",
      "support.priority",
      "api_access",
    ];
    for (const plan of PLAN_DEFINITIONS) {
      const keys = plan.entitlements.map((e) => e.key);
      expect(keys).toEqual(expectedKeys);
    }
  });

  it("free plan limits members to 2 and locations to 1", () => {
    const ent = resolvePlanEntitlements("free");
    expect(ent.find((e) => e.key === "members.max")?.limitValue).toBe(2n);
    expect(ent.find((e) => e.key === "locations.max")?.limitValue).toBe(1n);
  });

  it("enterprise plan has unlimited members (null limit)", () => {
    const ent = resolvePlanEntitlements("enterprise");
    expect(ent.find((e) => e.key === "members.max")?.limitValue).toBeNull();
  });

  it("isPlanKey narrows correctly", () => {
    expect(isPlanKey("free")).toBe(true);
    expect(isPlanKey("nonexistent")).toBe(false);
  });

  it("getPlanDefinition returns the plan or undefined", () => {
    expect(getPlanDefinition("starter")?.name).toBe("Starter");
    expect(getPlanDefinition("nope")).toBeUndefined();
  });
});
