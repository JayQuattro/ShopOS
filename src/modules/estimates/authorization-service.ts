import { randomUUID } from "node:crypto";

import type { AuthorizationMethod, PrismaClient } from "@/generated/prisma/client";
import { assertTenantAccess, type TenantContext } from "@/modules/tenancy/policy";
import { transitionStatus } from "@/modules/work-orders/work-order-service";

export type AuthorizationServiceInput = Readonly<{ db: PrismaClient; context: TenantContext }>;

export class AuthorizationFailed extends Error {
  constructor(
    public readonly reason:
      | "revision_not_found"
      | "revision_not_presented"
      | "line_not_found"
      | "line_not_in_revision"
      | "already_decided",
  ) {
    super("The authorization operation could not be completed.");
    this.name = "AuthorizationFailed";
  }
}

export type RecordAuthorizationInput = {
  revisionId: string;
  method: AuthorizationMethod;
  providedByName: string;
  note?: string;
  decisions: ReadonlyArray<{
    estimateLineId: string;
    decision: "APPROVED" | "DECLINED";
  }>;
};

/**
 * Records a customer authorization against a PRESENTED estimate revision.
 *
 * Decisions are per-line (APPROVED or DECLINED). Multiple lines can be decided
 * in one authorization event. An authorization is a historical record — once
 * recorded it cannot be edited. Partial approvals are supported: some lines
 * APPROVED, others DECLINED or left undecided.
 *
 * The revision must be in PRESENTED status — you cannot authorize a DRAFT.
 * After recording, the work order transitions to AUTHORIZED if at least one
 * line was approved.
 */
export async function recordAuthorization(
  input: AuthorizationServiceInput & RecordAuthorizationInput,
): Promise<Readonly<{ authorizationId: string }>> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "authorizations.record",
  );

  return input.db
    .$transaction(async (transaction) => {
      // Load the revision and verify it's PRESENTED.
      const revision = await transaction.estimateRevision.findFirst({
        where: { id: input.revisionId, organizationId: input.context.organizationId },
        select: {
          id: true,
          revisionNumber: true,
          workOrderId: true,
          locationId: true,
          status: true,
        },
      });
      if (!revision) throw new AuthorizationFailed("revision_not_found");
      if (revision.status !== "PRESENTED") throw new AuthorizationFailed("revision_not_presented");

      // Verify all referenced lines belong to this revision.
      const lineIds = input.decisions.map((d) => d.estimateLineId);
      const lines = await transaction.estimateLine.findMany({
        where: {
          id: { in: lineIds },
          organizationId: input.context.organizationId,
          estimateRevisionId: revision.id,
        },
        select: { id: true, authorizationRequired: true },
      });

      if (lines.length !== lineIds.length) {
        throw new AuthorizationFailed("line_not_in_revision");
      }

      // Check that none of these lines already have a decision.
      const existingDecisions = await transaction.authorizationDecision.findMany({
        where: { estimateLineId: { in: lineIds } },
        select: { estimateLineId: true },
      });
      if (existingDecisions.length > 0) {
        throw new AuthorizationFailed("already_decided");
      }

      // Create the authorization record.
      const authorization = await transaction.authorization.create({
        data: {
          id: randomUUID(),
          organizationId: input.context.organizationId,
          estimateRevisionId: revision.id,
          method: input.method,
          recordedByUserId: input.context.actorId,
          providedByName: input.providedByName,
          note: input.note ?? null,
          occurredAt: new Date(),
        },
      });

      // Create per-line decisions.
      for (const decision of input.decisions) {
        await transaction.authorizationDecision.create({
          data: {
            organizationId: input.context.organizationId,
            authorizationId: authorization.id,
            estimateLineId: decision.estimateLineId,
            decision: decision.decision,
          },
        });
      }

      // Activity event.
      const approvedCount = input.decisions.filter((d) => d.decision === "APPROVED").length;
      const declinedCount = input.decisions.filter((d) => d.decision === "DECLINED").length;
      await transaction.activityEvent.create({
        data: {
          id: randomUUID(),
          organizationId: input.context.organizationId,
          locationId: revision.locationId,
          workOrderId: revision.workOrderId,
          actorUserId: input.context.actorId,
          eventType: "authorization.recorded",
          summary: `Authorization recorded: ${approvedCount} approved, ${declinedCount} declined.`,
          data: { authorizationId: authorization.id, revisionNumber: revision.revisionNumber },
        },
      });

      // Tenant audit.
      await transaction.auditEvent.create({
        data: {
          id: randomUUID(),
          organizationId: input.context.organizationId,
          locationId: revision.locationId,
          actorUserId: input.context.actorId,
          action: "authorization.recorded",
          entityType: "authorization",
          entityId: authorization.id,
          requestId: input.context.requestId,
          after: {
            revisionId: revision.id,
            method: input.method,
            providedByName: input.providedByName,
            approved: approvedCount,
            declined: declinedCount,
          },
        },
      });

      return { authorizationId: authorization.id };
    })
    .then(async (result) => {
      // If at least one line was approved, transition the work order to AUTHORIZED.
      const hasApproval = input.decisions.some((d) => d.decision === "APPROVED");
      if (hasApproval) {
        const revision = await input.db.estimateRevision.findUnique({
          where: { id: input.revisionId },
          select: { workOrderId: true, status: true },
        });
        if (revision && revision.status === "PRESENTED") {
          await transitionStatus({
            db: input.db,
            context: input.context,
            workOrderId: revision.workOrderId,
            targetStatus: "AUTHORIZED",
          }).catch(() => undefined);
        }
      }
      return result;
    });
}

/**
 * Returns the authorization state for all lines in a revision: which lines
 * have been approved, declined, or are still pending.
 */
export async function getAuthorizationState(
  input: AuthorizationServiceInput & { revisionId: string },
): Promise<
  Readonly<{
    revisionId: string;
    lines: ReadonlyArray<{
      estimateLineId: string;
      decision: "APPROVED" | "DECLINED" | "PENDING";
      authorizationRequired: boolean;
    }>;
  }>
> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.read",
  );

  const revision = await input.db.estimateRevision.findFirst({
    where: { id: input.revisionId, organizationId: input.context.organizationId },
    select: { id: true },
  });
  if (!revision) throw new AuthorizationFailed("revision_not_found");

  const lines = await input.db.estimateLine.findMany({
    where: { estimateRevisionId: revision.id },
    select: { id: true, authorizationRequired: true },
  });

  const decisions = await input.db.authorizationDecision.findMany({
    where: {
      organizationId: input.context.organizationId,
      estimateLineId: { in: lines.map((l) => l.id) },
    },
    select: { estimateLineId: true, decision: true },
  });

  const decisionMap = new Map(decisions.map((d) => [d.estimateLineId, d.decision]));

  return {
    revisionId: revision.id,
    lines: lines.map((line) => ({
      estimateLineId: line.id,
      authorizationRequired: line.authorizationRequired,
      decision: (decisionMap.get(line.id) as "APPROVED" | "DECLINED" | undefined) ?? "PENDING",
    })),
  };
}
