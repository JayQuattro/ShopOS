import { describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { TenantAccessDenied } from "@/modules/tenancy/policy";
import {
  resolveTenantContext,
  TenantContextNotResolved,
} from "@/modules/tenancy/resolve-tenant-context";

/**
 * Builds a stub PrismaClient whose only organizationMembership.findFirst is
 * controllable. The resolver touches no other model, so this is sufficient for
 * unit-testing the resolution logic without a database.
 */
function makeDb(membership: unknown): PrismaClient {
  return {
    organizationMembership: {
      findFirst: async () => membership,
    },
  } as unknown as PrismaClient;
}

const activeMembership = {
  id: "membership-1",
  organizationId: "org-a",
  userId: "user-1",
  active: true,
  organizationWideLocationAccess: true,
  roles: [
    {
      role: {
        permissions: [
          "customers.read",
          "customers.write",
          "work_orders.read",
          "unknown.future.permission",
          42,
        ],
      },
    },
  ],
  locationAccess: [],
};

describe("resolveTenantContext", () => {
  it("rebuilds permissions, membership, and org-wide access from a membership", async () => {
    const context = await resolveTenantContext({
      db: makeDb(activeMembership),
      actorId: "user-1",
      organizationId: "org-a",
      requestId: "req-1",
    });

    expect(context.membershipId).toBe("membership-1");
    expect(context.organizationId).toBe("org-a");
    expect(context.organizationWideLocationAccess).toBe(true);
    expect(context.permissions).toEqual(
      new Set(["customers.read", "customers.write", "work_orders.read"]),
    );
    // Unknown/invalid permission entries are dropped, not thrown.
    expect(context.permissions.has("unknown.future.permission" as never)).toBe(false);
  });

  it("fails closed when no membership exists for the actor in that organization", async () => {
    await expect(
      resolveTenantContext({
        db: makeDb(null),
        actorId: "user-1",
        organizationId: "org-b",
        requestId: "req-1",
      }),
    ).rejects.toMatchObject({ name: "TenantContextNotResolved", reason: "membership_not_found" });
  });

  it("rejects an inactive membership", async () => {
    await expect(
      resolveTenantContext({
        db: makeDb({ ...activeMembership, active: false }),
        actorId: "user-1",
        organizationId: "org-a",
        requestId: "req-1",
      }),
    ).rejects.toMatchObject({ reason: "membership_inactive" });
  });

  it("rebuilds allowed location ids from location-access grants", async () => {
    const limited = {
      ...activeMembership,
      organizationWideLocationAccess: false,
      locationAccess: [{ locationId: "location-a" }, { locationId: "location-b" }],
    };

    const context = await resolveTenantContext({
      db: makeDb(limited),
      actorId: "user-1",
      organizationId: "org-a",
      requestId: "req-1",
    });

    expect(context.organizationWideLocationAccess).toBe(false);
    expect(context.allowedLocationIds).toEqual(new Set(["location-a", "location-b"]));
  });

  it("accepts a selected location that is in the allowed set", async () => {
    const limited = {
      ...activeMembership,
      organizationWideLocationAccess: false,
      locationAccess: [{ locationId: "location-a" }],
    };

    const context = await resolveTenantContext({
      db: makeDb(limited),
      actorId: "user-1",
      organizationId: "org-a",
      requestId: "req-1",
      selectedLocationId: "location-a",
    });

    expect(context.selectedLocationId).toBe("location-a");
  });

  it("rejects a selected location outside the allowed set as an access denial", async () => {
    const limited = {
      ...activeMembership,
      organizationWideLocationAccess: false,
      locationAccess: [{ locationId: "location-a" }],
    };

    await expect(
      resolveTenantContext({
        db: makeDb(limited),
        actorId: "user-1",
        organizationId: "org-a",
        requestId: "req-1",
        selectedLocationId: "location-other",
      }),
    ).rejects.toThrowError(TenantAccessDenied);
  });

  it("throws a typed TenantContextNotResolved error", async () => {
    try {
      await resolveTenantContext({
        db: makeDb(null),
        actorId: "user-1",
        organizationId: "org-x",
        requestId: "req-1",
      });
      throw new Error("expected rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(TenantContextNotResolved);
    }
  });
});
