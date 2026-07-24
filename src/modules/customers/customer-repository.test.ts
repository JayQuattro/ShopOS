import { describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { CustomerRepository } from "@/modules/customers/customer-repository";
import { TenantAccessDenied, type TenantContext } from "@/modules/tenancy/policy";

function makeContext(overrides: Partial<TenantContext> = {}): TenantContext {
  return {
    actorId: "user-1",
    organizationId: "org-a",
    membershipId: "membership-1",
    requestId: "req-1",
    organizationWideLocationAccess: true,
    allowedLocationIds: new Set(),
    permissions: new Set(["customers.read", "customers.write"]),
    ...overrides,
  };
}

type FindFirstArgs = { where: Record<string, unknown> };
type FindManyArgs = { where: Record<string, unknown> };
type CreateArgs = { data: Record<string, unknown> };

/**
 * Stub Prisma client that captures the arguments passed to each customer
 * method, so the tests can assert the tenant-scoped `where`/`data` clauses
 * without a database.
 */
function makeCapturingDb(captures: {
  findFirst?: FindFirstArgs[];
  findMany?: FindManyArgs[];
  create?: CreateArgs[];
  findFirstResult?: unknown;
  findManyResult?: unknown;
  createResult?: unknown;
}): PrismaClient {
  return {
    customer: {
      findFirst: async (args: FindFirstArgs) => {
        captures.findFirst?.push(args);
        return captures.findFirstResult ?? null;
      },
      findMany: async (args: FindManyArgs) => {
        captures.findMany?.push(args);
        return captures.findManyResult ?? [];
      },
      create: async (args: CreateArgs) => {
        captures.create?.push(args);
        return captures.createResult ?? { id: "cust-1" };
      },
    },
  } as unknown as PrismaClient;
}

describe("CustomerRepository scoping", () => {
  it("scopes findById by the context organization id", async () => {
    const findFirst: FindFirstArgs[] = [];
    const repo = new CustomerRepository({
      db: makeCapturingDb({ findFirst, findFirstResult: null }),
      context: makeContext(),
    });

    await repo.findById("cust-1");

    expect(findFirst[0]?.where).toMatchObject({ id: "cust-1", organizationId: "org-a" });
  });

  it("scopes list by the context organization id and applies the search filter", async () => {
    const findMany: FindManyArgs[] = [];
    const repo = new CustomerRepository({
      db: makeCapturingDb({ findMany, findManyResult: [] }),
      context: makeContext(),
    });

    await repo.list({ search: "Atlas" });

    expect(findMany[0]?.where).toMatchObject({
      organizationId: "org-a",
      displayName: { contains: "Atlas" },
    });
  });

  it("derives the organization id from the context on create, never from input", async () => {
    const create: CreateArgs[] = [];
    const repo = new CustomerRepository({
      db: makeCapturingDb({
        create,
        createResult: { id: "cust-new", organizationId: "org-a" },
      }),
      context: makeContext(),
    });

    await repo.create({
      kind: "INDIVIDUAL",
      displayName: "New Customer",
      // A malicious caller cannot override the organization:
      ...({ organizationId: "org-b" } as unknown as Record<string, unknown>),
    });

    expect(create[0]?.data).toMatchObject({ organizationId: "org-a", displayName: "New Customer" });
  });

  it("denies reads without the customers.read permission", async () => {
    const repo = new CustomerRepository({
      db: makeCapturingDb({}),
      context: makeContext({ permissions: new Set(["customers.write"]) }),
    });

    await expect(repo.findById("cust-1")).rejects.toThrowError(TenantAccessDenied);
  });

  it("denies creates without the customers.write permission", async () => {
    const repo = new CustomerRepository({
      db: makeCapturingDb({}),
      context: makeContext({ permissions: new Set(["customers.read"]) }),
    });

    await expect(repo.create({ kind: "INDIVIDUAL", displayName: "Denied" })).rejects.toThrowError(
      TenantAccessDenied,
    );
  });

  it("returns null for a customer not found in the scoped organization", async () => {
    const repo = new CustomerRepository({
      db: makeCapturingDb({ findFirstResult: null }),
      context: makeContext(),
    });

    const result = await repo.findById("does-not-exist");
    expect(result).toBeNull();
  });
});
