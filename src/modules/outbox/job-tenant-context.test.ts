import { describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import {
  JobTenantContextInvalid,
  revalidateJobTenantContext,
} from "@/modules/outbox/job-tenant-context";

function makeDb(organization: { id: string; status: string } | null): PrismaClient {
  return {
    organization: {
      findUnique: async () => organization,
    },
  } as unknown as PrismaClient;
}

describe("revalidateJobTenantContext", () => {
  it("returns the verified context for an active organization", async () => {
    const context = await revalidateJobTenantContext({
      db: makeDb({ id: "org-1", status: "ACTIVE" }),
      organizationId: "org-1",
      requestId: "job-1",
    });
    expect(context).toEqual({
      organizationId: "org-1",
      requestId: "job-1",
      organizationStatus: "ACTIVE",
    });
  });

  it("throws when the organization no longer exists", async () => {
    await expect(
      revalidateJobTenantContext({
        db: makeDb(null),
        organizationId: "org-gone",
        requestId: "job-1",
      }),
    ).rejects.toMatchObject({
      name: "JobTenantContextInvalid",
      reason: "organization_not_found",
    });
  });

  it("throws when the organization is suspended", async () => {
    await expect(
      revalidateJobTenantContext({
        db: makeDb({ id: "org-1", status: "SUSPENDED" }),
        organizationId: "org-1",
        requestId: "job-1",
      }),
    ).rejects.toMatchObject({
      name: "JobTenantContextInvalid",
      reason: "organization_suspended",
    });
  });

  it("throws a typed JobTenantContextInvalid error", async () => {
    try {
      await revalidateJobTenantContext({
        db: makeDb(null),
        organizationId: "org-x",
        requestId: "job-1",
      });
      throw new Error("expected rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(JobTenantContextInvalid);
    }
  });
});
