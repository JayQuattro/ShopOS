import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import { assertTenantAccess, type TenantContext } from "@/modules/tenancy/policy";
import {
  canTransition,
  InvalidStatusTransition,
  type WorkOrderStatus,
} from "./work-order-state-machine";

type TransactionalClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$use" | "$extends"
>;

export type WorkOrderServiceInput = Readonly<{ db: PrismaClient; context: TenantContext }>;

export class WorkOrderTransitionFailed extends Error {
  constructor(
    public readonly reason:
      | "work_order_not_found"
      | "invalid_transition"
      | "concurrent_change"
      | "authorization_required"
      | "estimate_required",
  ) {
    super("The work-order transition could not be completed.");
    this.name = "WorkOrderTransitionFailed";
  }
}

/**
 * Checks whether a work order has the prerequisites for a given target status.
 * Throws WorkOrderTransitionFailed with a specific reason if not met.
 *
 * Business rules:
 * - ESTIMATING: no prerequisites (can always start estimating).
 * - AWAITING_AUTHORIZATION: requires at least one PRESENTED estimate revision.
 * - AUTHORIZED: requires at least one APPROVED authorization decision.
 * - IN_PROGRESS: only reachable from AUTHORIZED or BLOCKED (state machine handles this).
 * - COMPLETED: no additional check beyond the state machine.
 */
async function assertTransitionPrerequisites(
  transaction: TransactionalClient,
  organizationId: string,
  workOrderId: string,
  targetStatus: WorkOrderStatus,
): Promise<void> {
  if (targetStatus === "AWAITING_AUTHORIZATION") {
    const hasPresentedRevision = await transaction.estimateRevision.findFirst({
      where: { workOrderId, organizationId, status: "PRESENTED" },
      select: { id: true },
    });
    if (!hasPresentedRevision) {
      throw new WorkOrderTransitionFailed("estimate_required");
    }
  }

  if (targetStatus === "AUTHORIZED") {
    // Check that at least one line has been approved via an authorization decision.
    const hasApproval = await transaction.authorizationDecision.findFirst({
      where: {
        decision: "APPROVED",
        organizationId,
        estimateLine: {
          revision: { workOrderId },
        },
      },
      select: { authorizationId: true },
    });
    if (!hasApproval) {
      throw new WorkOrderTransitionFailed("authorization_required");
    }
  }
}

/**
 * Transitions a work order to a new status, enforcing the documented state
 * machine and business prerequisites. Writes an activity event and audit event
 * in the same transaction.
 *
 * Safety enforcement (AGENTS.md):
 * - Cannot move to AWAITING_AUTHORIZATION without a presented estimate.
 * - Cannot move to AUTHORIZED without at least one approved authorization.
 * - Cannot bypass the state machine (e.g. DRAFT directly to IN_PROGRESS).
 */
export async function transitionStatus(
  input: WorkOrderServiceInput & {
    workOrderId: string;
    targetStatus: WorkOrderStatus;
  },
): Promise<void> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );

  await input.db.$transaction(async (transaction) => {
    const wo = await transaction.workOrder.findFirst({
      where: { id: input.workOrderId, organizationId: input.context.organizationId },
      select: { id: true, number: true, status: true, locationId: true },
    });
    if (!wo) throw new WorkOrderTransitionFailed("work_order_not_found");

    const currentStatus = wo.status as WorkOrderStatus;
    if (!canTransition(currentStatus, input.targetStatus)) {
      throw new InvalidStatusTransition(currentStatus, input.targetStatus);
    }

    // Enforce business prerequisites for sensitive transitions.
    await assertTransitionPrerequisites(
      transaction,
      input.context.organizationId,
      wo.id,
      input.targetStatus,
    );

    const update = await transaction.workOrder.updateMany({
      where: { id: wo.id, status: currentStatus },
      data: {
        status: input.targetStatus,
        ...(input.targetStatus === "COMPLETED" ? { completedAt: new Date() } : {}),
      },
    });
    if (update.count !== 1) throw new WorkOrderTransitionFailed("concurrent_change");

    // Activity event.
    await transaction.activityEvent.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        locationId: wo.locationId,
        workOrderId: wo.id,
        actorUserId: input.context.actorId,
        eventType: "work_order.status_changed",
        summary: `Status changed from ${currentStatus} to ${input.targetStatus}.`,
        data: { from: currentStatus, to: input.targetStatus },
      },
    });

    // Tenant audit.
    await recordAudit(transaction, {
      organizationId: input.context.organizationId,
      locationId: wo.locationId,
      actorUserId: input.context.actorId,
      requestId: input.context.requestId,
      action: "work_order.status_changed",
      entityType: "work_order",
      entityId: wo.id,
      before: { status: currentStatus },
      after: { status: input.targetStatus },
    });
  });
}

function recordAudit(
  transaction: TransactionalClient,
  args: {
    organizationId: string;
    locationId?: string;
    actorUserId: string;
    requestId: string;
    action: string;
    entityType: string;
    entityId: string;
    before?: unknown;
    after?: unknown;
  },
) {
  return transaction.auditEvent.create({
    data: {
      id: randomUUID(),
      organizationId: args.organizationId,
      ...(args.locationId ? { locationId: args.locationId } : {}),
      actorUserId: args.actorUserId,
      action: args.action,
      entityType: args.entityType,
      entityId: args.entityId,
      requestId: args.requestId,
      ...(args.before !== undefined ? { before: args.before as object } : {}),
      ...(args.after !== undefined ? { after: args.after as object } : {}),
    },
  });
}
