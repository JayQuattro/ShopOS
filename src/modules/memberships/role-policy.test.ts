import { describe, expect, it } from "vitest";

import { ALL_TENANT_PERMISSIONS } from "./built-in-role-templates";
import {
  assertRoleGrantable,
  BUILT_IN_ROLE_KEYS,
  countActiveOwners,
  InvalidBuiltInRole,
  isOwnerMembership,
  LastOwnerProtected,
  requireBuiltInRoleKey,
  RoleEscalationDenied,
  type OwnerCheckMembership,
} from "./role-policy";

const ALL = new Set<string>(ALL_TENANT_PERMISSIONS);

const MANAGER = new Set<string>(
  ALL_TENANT_PERMISSIONS.filter((permission) => permission !== "organizations.manage"),
);

const ADVISOR = new Set<string>(
  ALL_TENANT_PERMISSIONS.filter(
    (permission) => permission !== "organizations.manage" && permission !== "memberships.manage",
  ),
);

function membership(authRole: string, roleKeys: string[] = []): OwnerCheckMembership {
  return { authRole, roles: roleKeys.map((key) => ({ role: { key } })) };
}

describe("requireBuiltInRoleKey", () => {
  it("accepts the six built-in keys", () => {
    expect(BUILT_IN_ROLE_KEYS).toEqual([
      "owner",
      "manager",
      "advisor",
      "technician",
      "parts",
      "administrator",
    ]);
    for (const key of BUILT_IN_ROLE_KEYS) {
      expect(requireBuiltInRoleKey(key)).toBe(key);
    }
  });

  it("throws InvalidBuiltInRole for unknown keys", () => {
    expect(() => requireBuiltInRoleKey("superuser")).toThrowError(InvalidBuiltInRole);
    expect(() => requireBuiltInRoleKey("")).toThrowError(InvalidBuiltInRole);
  });
});

describe("assertRoleGrantable (privilege escalation guard)", () => {
  it("allows a full-permission actor to grant any role", () => {
    expect(() => assertRoleGrantable("owner", ALL)).not.toThrow();
    expect(() => assertRoleGrantable("administrator", ALL)).not.toThrow();
    expect(() => assertRoleGrantable("technician", ALL)).not.toThrow();
  });

  it("allows a manager to grant roles it fully holds (manager, advisor, technician, parts)", () => {
    expect(() => assertRoleGrantable("manager", MANAGER)).not.toThrow();
    expect(() => assertRoleGrantable("advisor", MANAGER)).not.toThrow();
    expect(() => assertRoleGrantable("technician", MANAGER)).not.toThrow();
    expect(() => assertRoleGrantable("parts", MANAGER)).not.toThrow();
  });

  it("denies a manager from granting owner or administrator (both carry organizations.manage)", () => {
    expect(() => assertRoleGrantable("owner", MANAGER)).toThrowError(RoleEscalationDenied);
    expect(() => assertRoleGrantable("administrator", MANAGER)).toThrowError(RoleEscalationDenied);
  });

  it("denies an advisor from granting any memberships-managing role", () => {
    expect(() => assertRoleGrantable("owner", ADVISOR)).toThrowError(RoleEscalationDenied);
    expect(() => assertRoleGrantable("manager", ADVISOR)).toThrowError(RoleEscalationDenied);
    expect(() => assertRoleGrantable("administrator", ADVISOR)).toThrowError(RoleEscalationDenied);
  });
});

describe("isOwnerMembership", () => {
  it("treats authRole owner as an owner even without the role link", () => {
    expect(isOwnerMembership(membership("owner", []))).toBe(true);
  });

  it("treats a membership carrying the owner role as an owner", () => {
    expect(isOwnerMembership(membership("member", ["owner", "advisor"]))).toBe(true);
  });

  it("does not treat a non-owner membership as an owner", () => {
    expect(isOwnerMembership(membership("member", ["manager"]))).toBe(false);
    expect(isOwnerMembership(membership("member", []))).toBe(false);
  });
});

describe("countActiveOwners", () => {
  it("counts memberships whose authRole is owner or that carry the owner role", async () => {
    const findMany = async () =>
      [
        membership("owner", []),
        membership("member", ["owner"]),
        membership("member", ["manager"]),
        membership("member", []),
      ] satisfies OwnerCheckMembership[];
    const transaction = { organizationMembership: { findMany } };

    const count = await countActiveOwners(transaction as never, "org-a");
    expect(count).toBe(2);
  });
});

describe("LastOwnerProtected", () => {
  it("is a typed error", () => {
    const error = new LastOwnerProtected();
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("LastOwnerProtected");
  });
});
