import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import type { TransactionalClient } from "@/modules/estimates/estimate-service";
import { assertTenantAccess, type TenantContext } from "@/modules/tenancy/policy";

export type QcServiceInput = Readonly<{ db: PrismaClient; context: TenantContext }>;

export class QualityCheckFailed extends Error {
  constructor(
    public readonly reason:
      "work_order_not_found" | "invalid_note" | "already_passed" | "open_tasks",
  ) {
    super("The quality check operation could not be completed.");
    this.name = "QualityCheckFailed";
  }
}

/**
 * Passes the final quality check: the work order's inspection checklist must
 * have no OPEN or NEEDS_ATTENTION items (flagged findings must be resolved
 * into change orders or marked). Records who passed and when; the work order
 * is then eligible to complete.
 */
export async function passQualityCheck(
  input: QcServiceInput & { workOrderId: string; note?: string },
): Promise<void> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );

  const note = input.note?.trim();
  if (note !== undefined && note.length > 2000) throw new QualityCheckFailed("invalid_note");

  await input.db.$transaction(async (transaction) => {
    const workOrder = await loadForQc(transaction, input.context, input.workOrderId);
    if (workOrder.qcStatus === "passed") throw new QualityCheckFailed("already_passed");

    const open = await transaction.workOrderTask.findFirst({
      where: {
        organizationId: input.context.organizationId,
        workOrderId: workOrder.id,
        status: { in: ["OPEN", "NEEDS_ATTENTION"] },
      },
      select: { id: true },
    });
    if (open) throw new QualityCheckFailed("open_tasks");

    await transaction.workOrder.update({
      where: { id: workOrder.id },
      data: {
        qcStatus: "passed",
        qcNote: note || null,
        qcPassedByUserId: input.context.actorId,
        qcPassedAt: new Date(),
      },
    });

    await recordActivity(transaction, input.context, {
      workOrderId: workOrder.id,
      locationId: workOrder.locationId,
      eventType: "quality_check.passed",
      summary: note ? `Quality check passed — ${note}` : "Quality check passed.",
    });
  });
}

/**
 * Fails the quality check, sending the job back for rework. The work order is
 * no longer eligible to complete until the check passes again.
 */
export async function failQualityCheck(
  input: QcServiceInput & { workOrderId: string; note: string },
): Promise<void> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );

  const note = input.note.trim();
  if (note.length < 3) throw new QualityCheckFailed("invalid_note");

  await input.db.$transaction(async (transaction) => {
    const workOrder = await loadForQc(transaction, input.context, input.workOrderId);

    await transaction.workOrder.update({
      where: { id: workOrder.id },
      data: {
        qcStatus: "failed",
        qcNote: note,
        qcPassedByUserId: null,
        qcPassedAt: null,
      },
    });

    await recordActivity(transaction, input.context, {
      workOrderId: workOrder.id,
      locationId: workOrder.locationId,
      eventType: "quality_check.failed",
      summary: `Quality check failed — ${note}`,
    });
  });
}

export type QualityCheckState = Readonly<{
  status: "pending" | "passed" | "failed";
  note: string | null;
  passedByDisplayName: string | null;
  passedAt: Date | null;
  required: boolean;
  openTaskCount: number;
}>;

export async function getQualityCheckState(
  input: QcServiceInput & { workOrderId: string },
): Promise<QualityCheckState> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.read",
  );

  const workOrder = await input.db.workOrder.findFirst({
    where: { id: input.workOrderId, organizationId: input.context.organizationId },
    select: {
      qcStatus: true,
      qcNote: true,
      qcPassedAt: true,
      qcPassedBy: { select: { displayName: true } },
      organization: { select: { qualityCheckRequired: true } },
    },
  });
  if (!workOrder) throw new QualityCheckFailed("work_order_not_found");

  const openTaskCount = await input.db.workOrderTask.count({
    where: {
      organizationId: input.context.organizationId,
      workOrderId: input.workOrderId,
      status: { in: ["OPEN", "NEEDS_ATTENTION"] },
    },
  });

  return {
    status: workOrder.qcStatus as QualityCheckState["status"],
    note: workOrder.qcNote,
    passedByDisplayName: workOrder.qcPassedBy?.displayName ?? null,
    passedAt: workOrder.qcPassedAt,
    required: workOrder.organization.qualityCheckRequired,
    openTaskCount,
  };
}

async function loadForQc(
  transaction: TransactionalClient,
  context: TenantContext,
  workOrderId: string,
) {
  const workOrder = await transaction.workOrder.findFirst({
    where: { id: workOrderId, organizationId: context.organizationId },
    select: { id: true, locationId: true, qcStatus: true },
  });
  if (!workOrder) throw new QualityCheckFailed("work_order_not_found");
  return workOrder;
}

async function recordActivity(
  transaction: TransactionalClient,
  context: TenantContext,
  input: Readonly<{
    workOrderId: string;
    locationId: string;
    eventType: string;
    summary: string;
  }>,
): Promise<void> {
  await transaction.activityEvent.create({
    data: {
      id: randomUUID(),
      organizationId: context.organizationId,
      locationId: input.locationId,
      workOrderId: input.workOrderId,
      actorUserId: context.actorId,
      eventType: input.eventType,
      summary: input.summary,
    },
  });
}
