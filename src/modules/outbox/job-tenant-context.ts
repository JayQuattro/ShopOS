import type { PrismaClient } from "@/generated/prisma/client";

export type JobTenantContext = Readonly<{
  organizationId: string;
  requestId: string;
  organizationStatus: string;
}>;

export type JobTenantContextInvalidReason = "organization_not_found" | "organization_suspended";

export class JobTenantContextInvalid extends Error {
  readonly reason: JobTenantContextInvalidReason;

  constructor(reason: JobTenantContextInvalidReason) {
    super("The background job's tenant context is not valid for processing.");
    this.name = "JobTenantContextInvalid";
    this.reason = reason;
  }
}

/**
 * Revalidates the tenant context for a background job.
 *
 * Background jobs run outside the HTTP request lifecycle, so they cannot call
 * `getRequestContext()` (which depends on `next/headers` and the session). Each
 * outbox event carries `organizationId` as an authoritative column (set inside
 * the originating mutation's transaction, never from untrusted input).
 *
 * This function verifies the organization still exists and is active before the
 * handler runs. A suspended or deleted organization should not produce side
 * effects. The `requestId` is synthesized by the worker for audit attribution.
 *
 * Most outbox events are administrative (org provisioned, membership changed)
 * and do not need a user-bound `TenantContext`; org-existence + status is the
 * correct tenant boundary for a system worker.
 */
export async function revalidateJobTenantContext(
  input: Readonly<{ db: PrismaClient; organizationId: string; requestId: string }>,
): Promise<JobTenantContext> {
  const organization = await input.db.organization.findUnique({
    where: { id: input.organizationId },
    select: { id: true, status: true },
  });

  if (!organization) {
    throw new JobTenantContextInvalid("organization_not_found");
  }

  if (organization.status === "SUSPENDED") {
    throw new JobTenantContextInvalid("organization_suspended");
  }

  return {
    organizationId: organization.id,
    requestId: input.requestId,
    organizationStatus: organization.status,
  };
}
