import { describe, expect, it } from "vitest";
import {
  assertLocationCanBeSelected,
  assertTenantAccess,
  TenantAccessDenied,
  type TenantContext,
} from "./policy";

const context: TenantContext = {
  actorId: "user-a",
  organizationId: "org-a",
  membershipId: "membership-a",
  requestId: "request-1",
  organizationWideLocationAccess: false,
  allowedLocationIds: new Set(["location-a"]),
  permissions: new Set(["work_orders.read"]),
};

describe("tenant policy", () => {
  it("allows an authorized record in an allowed organization and location", () => {
    expect(() =>
      assertTenantAccess(
        context,
        { organizationId: "org-a", locationId: "location-a" },
        "work_orders.read",
      ),
    ).not.toThrow();
  });

  it("denies cross-organization identifier guessing", () => {
    expect(() =>
      assertTenantAccess(
        context,
        { organizationId: "org-b", locationId: "location-a" },
        "work_orders.read",
      ),
    ).toThrowError(TenantAccessDenied);
  });

  it("denies a different location in the same organization", () => {
    expect(() =>
      assertTenantAccess(
        context,
        { organizationId: "org-a", locationId: "location-b" },
        "work_orders.read",
      ),
    ).toThrowError(TenantAccessDenied);
  });

  it("denies a mutation without permission", () => {
    expect(() =>
      assertTenantAccess(
        context,
        { organizationId: "org-a", locationId: "location-a" },
        "work_orders.write",
      ),
    ).toThrowError(TenantAccessDenied);
  });

  it("allows organization-scoped records without a location", () => {
    expect(() =>
      assertTenantAccess(context, { organizationId: "org-a" }, "work_orders.read"),
    ).not.toThrow();
  });

  it("lets organization-wide members select a new location", () => {
    expect(() =>
      assertLocationCanBeSelected(
        { ...context, organizationWideLocationAccess: true },
        "location-new",
      ),
    ).not.toThrow();
  });
});
