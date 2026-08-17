import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import type { TransactionalClient } from "@/modules/estimates/estimate-service";
import { addLine } from "@/modules/estimates/estimate-service";
import { createChangeOrder } from "@/modules/estimates/change-order-service";
import { assertTenantAccess, type TenantContext } from "@/modules/tenancy/policy";

export type TaskServiceInput = Readonly<{ db: PrismaClient; context: TenantContext }>;

export type WorkOrderTaskStatusValue = "OPEN" | "DONE" | "NEEDS_ATTENTION" | "SKIPPED";

export class TaskFailed extends Error {
  constructor(
    public readonly reason:
      | "work_order_not_found"
      | "task_not_found"
      | "invalid_title"
      | "invalid_status"
      | "invalid_transition"
      | "no_flagged_tasks"
      | "work_order_not_authorized"
      | "change_order_pending_exists",
  ) {
    super("The work-order task operation could not be completed.");
    this.name = "TaskFailed";
  }
}

/**
 * Adds a checklist / inspection item to a work order.
 */
export async function addTask(
  input: TaskServiceInput & { workOrderId: string; title: string; outcomeNote?: string },
): Promise<Readonly<{ taskId: string }>> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );

  const title = input.title.trim();
  if (title.length < 3 || title.length > 200) throw new TaskFailed("invalid_title");

  return input.db.$transaction(async (transaction) => {
    const workOrder = await loadWorkOrder(transaction, input.context, input.workOrderId);

    const latest = await transaction.workOrderTask.findFirst({
      where: { workOrderId: workOrder.id },
      orderBy: { position: "desc" },
      select: { position: true },
    });

    const task = await transaction.workOrderTask.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        locationId: workOrder.locationId,
        workOrderId: workOrder.id,
        position: (latest?.position ?? 0) + 1,
        title,
        ...(input.outcomeNote ? { outcomeNote: input.outcomeNote.trim() } : {}),
        createdByUserId: input.context.actorId,
      },
    });

    return { taskId: task.id };
  });
}

/**
 * Updates a task's status (and optional outcome note). Flagging an item as
 * NEEDS_ATTENTION records why — that note becomes the line description's
 * context when the flagged items are converted into a change order.
 */
export async function updateTaskStatus(
  input: TaskServiceInput & {
    taskId: string;
    status: WorkOrderTaskStatusValue;
    outcomeNote?: string;
  },
): Promise<void> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );

  const note = input.outcomeNote?.trim();

  await input.db.$transaction(async (transaction) => {
    const task = await transaction.workOrderTask.findFirst({
      where: { id: input.taskId, organizationId: input.context.organizationId },
      select: { id: true, workOrderId: true, locationId: true, title: true, status: true },
    });
    if (!task) throw new TaskFailed("task_not_found");
    if (task.status === input.status && note === undefined) return;

    await transaction.workOrderTask.update({
      where: { id: task.id },
      data: {
        status: input.status,
        ...(note !== undefined ? { outcomeNote: note || null } : {}),
      },
    });

    const summary: Record<WorkOrderTaskStatusValue, string> = {
      OPEN: `Task reopened: ${task.title}.`,
      DONE: `Task completed: ${task.title}.`,
      NEEDS_ATTENTION: `Inspection flagged: ${task.title}${note ? ` — ${note}` : ""}.`,
      SKIPPED: `Task skipped: ${task.title}.`,
    };

    await transaction.activityEvent.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        locationId: task.locationId,
        workOrderId: task.workOrderId,
        actorUserId: input.context.actorId,
        eventType: input.status === "NEEDS_ATTENTION" ? "task.flagged" : "task.status_changed",
        summary: summary[input.status],
      },
    });
  });
}

export type WorkOrderTaskSummary = Readonly<{
  id: string;
  position: number;
  title: string;
  status: WorkOrderTaskStatusValue;
  outcomeNote: string | null;
}>;

export async function listTasks(
  input: TaskServiceInput & { workOrderId: string },
): Promise<readonly WorkOrderTaskSummary[]> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.read",
  );

  const workOrder = await loadWorkOrder(input.db, input.context, input.workOrderId);

  const tasks = await input.db.workOrderTask.findMany({
    where: { organizationId: input.context.organizationId, workOrderId: workOrder.id },
    orderBy: { position: "asc" },
    select: { id: true, position: true, title: true, status: true, outcomeNote: true },
  });

  return tasks.map((task) => ({
    id: task.id,
    position: task.position,
    title: task.title,
    status: task.status as WorkOrderTaskStatusValue,
    outcomeNote: task.outcomeNote,
  }));
}

/**
 * Converts the flagged (NEEDS_ATTENTION) tasks into a draft change order:
 * each flagged task becomes an editable line at zero price with its outcome
 * note in the summary. The shop prices the lines before presenting.
 */
export async function createChangeOrderFromFlaggedTasks(
  input: TaskServiceInput & { workOrderId: string },
): Promise<Readonly<{ revisionId: string; changeOrderNumber: number; lineCount: number }>> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );

  const workOrder = await loadWorkOrder(input.db, input.context, input.workOrderId);

  const flagged = await input.db.workOrderTask.findMany({
    where: {
      organizationId: input.context.organizationId,
      workOrderId: workOrder.id,
      status: "NEEDS_ATTENTION",
    },
    orderBy: { position: "asc" },
    select: { id: true, title: true, outcomeNote: true },
  });
  if (flagged.length === 0) throw new TaskFailed("no_flagged_tasks");

  const summaryNote = `Found during inspection: ${flagged.map((task) => task.title).join("; ")}.`;

  const created = await createChangeOrder({
    db: input.db,
    context: input.context,
    workOrderId: workOrder.id,
    note: summaryNote.slice(0, 1000),
  });

  let position = 0;
  for (const task of flagged) {
    position += 1;
    await addLine({
      db: input.db,
      context: input.context,
      revisionId: created.revisionId,
      kind: "FEE",
      serviceGroupKey: "inspection",
      description: task.outcomeNote ? `${task.title} — ${task.outcomeNote}` : task.title,
      quantityMilli: 1000,
      unitPriceMinor: 0,
      discountMinor: 0,
      taxable: false,
      taxRateBasisPoints: 0,
      position,
    });
  }

  return {
    revisionId: created.revisionId,
    changeOrderNumber: created.changeOrderNumber,
    lineCount: flagged.length,
  };
}

async function loadWorkOrder(
  db: PrismaClient | TransactionalClient,
  context: TenantContext,
  workOrderId: string,
) {
  const workOrder = await db.workOrder.findFirst({
    where: { id: workOrderId, organizationId: context.organizationId },
    select: { id: true, locationId: true, status: true },
  });
  if (!workOrder) throw new TaskFailed("work_order_not_found");
  return workOrder;
}
