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
    public readonly reason: "work_order_not_found" | "invalid_transition" | "concurrent_change",
  ) {
    super("The work-order transition could not be completed.");
    this.name = "WorkOrderTransitionFailed";
  }
}

/**
 * Transitions a work order to a new status, enforcing the documented state
 * machine. Writes an activity event and audit event in the same transaction.
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
