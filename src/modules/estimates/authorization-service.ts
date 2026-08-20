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
      | "already_decided"
      | "conflicting_options",
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

      // Load every line of the revision (not just the decided ones) so option
      // groups can be resolved and siblings auto-declined.
      const revisionLines = await transaction.estimateLine.findMany({
        where: {
          organizationId: input.context.organizationId,
          estimateRevisionId: revision.id,
        },
        select: { id: true, optionGroupKey: true },
      });
      const revisionLineIds = revisionLines.map((line) => line.id);
      const submittedIds = new Set(input.decisions.map((d) => d.estimateLineId));

      // Verify all referenced lines belong to this revision.
      if (input.decisions.some((d) => !revisionLineIds.includes(d.estimateLineId))) {
        throw new AuthorizationFailed("line_not_in_revision");
      }

      // Option groups are alternatives: at most one APPROVED per group.
      const groupOfLine = new Map(revisionLines.map((line) => [line.id, line.optionGroupKey]));
      const approvedPerGroup = new Map<string, number>();
      for (const decision of input.decisions) {
        if (decision.decision !== "APPROVED") continue;
        const group = groupOfLine.get(decision.estimateLineId);
        if (!group) continue;
        const count = (approvedPerGroup.get(group) ?? 0) + 1;
        if (count > 1) throw new AuthorizationFailed("conflicting_options");
        approvedPerGroup.set(group, count);
      }

      // Check that none of the submitted lines already have a decision.
      const existingDecisions = await transaction.authorizationDecision.findMany({
        where: { estimateLineId: { in: revisionLineIds } },
        select: { estimateLineId: true },
      });
      const previouslyDecided = new Set(existingDecisions.map((d) => d.estimateLineId));
      if (input.decisions.some((d) => previouslyDecided.has(d.estimateLineId))) {
        throw new AuthorizationFailed("already_decided");
      }

      // Choosing one option implies declining its alternatives: undecided
      // siblings of an approved option get an explicit DECLINED decision so
      // the record (and the invoice) is unambiguous.
      const autoDeclined: string[] = [];
      for (const [group] of approvedPerGroup) {
        for (const line of revisionLines) {
          if (line.optionGroupKey !== group) continue;
          if (submittedIds.has(line.id) || previouslyDecided.has(line.id)) continue;
          autoDeclined.push(line.id);
        }
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

      // Create per-line decisions (submitted plus auto-declined siblings).
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
      for (const lineId of autoDeclined) {
        await transaction.authorizationDecision.create({
          data: {
            organizationId: input.context.organizationId,
            authorizationId: authorization.id,
            estimateLineId: lineId,
            decision: "DECLINED",
          },
        });
      }

      // Activity event.
      const approvedCount = input.decisions.filter((d) => d.decision === "APPROVED").length;
      const declinedCount =
        input.decisions.filter((d) => d.decision === "DECLINED").length + autoDeclined.length;
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

      // Customer receipt email via the outbox.
      await transaction.outboxEvent.create({
        data: {
          id: randomUUID(),
          organizationId: input.context.organizationId,
          eventType: "authorization.recorded",
          aggregateType: "authorization",
          aggregateId: authorization.id,
          payload: {
            revisionId: revision.id,
            workOrderId: revision.workOrderId,
            locationId: revision.locationId,
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
      description: string;
      totalMinor: string;
      decision: "APPROVED" | "DECLINED" | "PENDING";
      authorizationRequired: boolean;
      serviceGroupKey: string;
      serviceGroupLabel: string | null;
      optionGroupKey: string | null;
      optionGroupLabel: string | null;
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
    select: {
      id: true,
      authorizationRequired: true,
      description: true,
      totalMinor: true,
      serviceGroupKey: true,
      serviceGroupLabel: true,
      optionGroupKey: true,
      optionGroupLabel: true,
    },
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
      description: line.description,
      totalMinor: line.totalMinor.toString(),
      authorizationRequired: line.authorizationRequired,
      decision: (decisionMap.get(line.id) as "APPROVED" | "DECLINED" | undefined) ?? "PENDING",
      serviceGroupKey: line.serviceGroupKey,
      serviceGroupLabel: line.serviceGroupLabel,
      optionGroupKey: line.optionGroupKey,
      optionGroupLabel: line.optionGroupLabel,
    })),
  };
}
