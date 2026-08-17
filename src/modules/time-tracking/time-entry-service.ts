import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import type { TransactionalClient } from "@/modules/estimates/estimate-service";
import { assertTenantAccess, type TenantContext } from "@/modules/tenancy/policy";

export type TimeEntryServiceInput = Readonly<{ db: PrismaClient; context: TenantContext }>;

export class TimeEntryFailed extends Error {
  constructor(
    public readonly reason:
      | "work_order_not_found"
      | "user_not_a_member"
      | "timer_already_running"
      | "no_running_timer"
      | "invalid_time_range"
      | "entry_not_found",
  ) {
    super("The time entry operation could not be completed.");
    this.name = "TimeEntryFailed";
  }
}

/** Elapsed minutes between two instants, rounded to whole minutes. */
export function elapsedMinutes(startedAt: Date, endedAt: Date = new Date()): number {
  return Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 60_000));
}

function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0 ? `${hours}h ${rest}m` : `${rest}m`;
}

async function loadWorkOrder(db: TransactionalClient, context: TenantContext, workOrderId: string) {
  const workOrder = await db.workOrder.findFirst({
    where: { id: workOrderId, organizationId: context.organizationId },
    select: { id: true, locationId: true, number: true },
  });
  if (!workOrder) throw new TimeEntryFailed("work_order_not_found");
  return workOrder;
}

/**
 * Starts a running timer for the acting user on a work order. A user may have
 * at most one running timer in the organization — the database enforces it;
 * starting elsewhere requires stopping first.
 */
export async function startTimer(
  input: TimeEntryServiceInput & { workOrderId: string; note?: string },
): Promise<Readonly<{ entryId: string }>> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );

  return input.db.$transaction(async (transaction) => {
    const workOrder = await loadWorkOrder(transaction, input.context, input.workOrderId);

    const running = await transaction.timeEntry.findFirst({
      where: {
        organizationId: input.context.organizationId,
        userId: input.context.actorId,
        endedAt: null,
      },
      select: { id: true },
    });
    if (running) throw new TimeEntryFailed("timer_already_running");

    const entry = await transaction.timeEntry.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        locationId: workOrder.locationId,
        workOrderId: workOrder.id,
        userId: input.context.actorId,
        startedAt: new Date(),
        ...(input.note ? { note: input.note } : {}),
      },
    });

    await transaction.activityEvent.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        locationId: workOrder.locationId,
        workOrderId: workOrder.id,
        actorUserId: input.context.actorId,
        eventType: "time.started",
        summary: "Timer started.",
      },
    });

    return { entryId: entry.id };
  });
}

/**
 * Stops the acting user's running timer. When workOrderId is given, the
 * running timer must belong to that work order.
 */
export async function stopTimer(
  input: TimeEntryServiceInput & { workOrderId?: string },
): Promise<Readonly<{ entryId: string; minutes: number }>> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );

  return input.db.$transaction(async (transaction) => {
    const running = await transaction.timeEntry.findFirst({
      where: {
        organizationId: input.context.organizationId,
        userId: input.context.actorId,
        endedAt: null,
        ...(input.workOrderId ? { workOrderId: input.workOrderId } : {}),
      },
      select: { id: true, workOrderId: true, startedAt: true, locationId: true },
    });
    if (!running) throw new TimeEntryFailed("no_running_timer");

    const endedAt = new Date();
    if (endedAt <= running.startedAt) throw new TimeEntryFailed("invalid_time_range");

    await transaction.timeEntry.update({
      where: { id: running.id },
      data: { endedAt },
    });

    const minutes = elapsedMinutes(running.startedAt, endedAt);
    await transaction.activityEvent.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        locationId: running.locationId,
        workOrderId: running.workOrderId,
        actorUserId: input.context.actorId,
        eventType: "time.stopped",
        summary: `Timer stopped after ${formatDuration(minutes)}.`,
      },
    });

    return { entryId: running.id, minutes };
  });
}

/**
 * Records a completed entry with explicit times — the correction path for
 * "forgot to clock" and for logging work on behalf of a technician. The
 * worker must be an active organization member.
 */
export async function addManualEntry(
  input: TimeEntryServiceInput & {
    workOrderId: string;
    userId: string;
    startedAt: Date;
    endedAt: Date;
    note?: string;
  },
): Promise<Readonly<{ entryId: string }>> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );

  if (input.endedAt <= input.startedAt) throw new TimeEntryFailed("invalid_time_range");

  return input.db.$transaction(async (transaction) => {
    const workOrder = await loadWorkOrder(transaction, input.context, input.workOrderId);

    const membership = await transaction.organizationMembership.findFirst({
      where: { organizationId: input.context.organizationId, userId: input.userId, active: true },
      select: { id: true },
    });
    if (!membership) throw new TimeEntryFailed("user_not_a_member");

    const entry = await transaction.timeEntry.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        locationId: workOrder.locationId,
        workOrderId: workOrder.id,
        userId: input.userId,
        startedAt: input.startedAt,
        endedAt: input.endedAt,
        ...(input.note ? { note: input.note } : {}),
      },
    });

    await transaction.activityEvent.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        locationId: workOrder.locationId,
        workOrderId: workOrder.id,
        actorUserId: input.context.actorId,
        eventType: "time.recorded",
        summary: `Time entry recorded: ${formatDuration(
          elapsedMinutes(input.startedAt, input.endedAt),
        )}.`,
      },
    });

    return { entryId: entry.id };
  });
}

export type TimeEntrySummary = Readonly<{
  id: string;
  userId: string;
  userDisplayName: string;
  startedAt: Date;
  endedAt: Date | null;
  minutes: number | null;
  note: string | null;
}>;

export async function listTimeEntries(
  input: TimeEntryServiceInput & { workOrderId: string },
): Promise<readonly TimeEntrySummary[]> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.read",
  );

  const workOrder = await loadWorkOrder(input.db, input.context, input.workOrderId);

  const entries = await input.db.timeEntry.findMany({
    where: { organizationId: input.context.organizationId, workOrderId: workOrder.id },
    orderBy: { startedAt: "desc" },
    select: {
      id: true,
      userId: true,
      startedAt: true,
      endedAt: true,
      note: true,
      user: { select: { displayName: true } },
    },
  });

  return entries.map((entry) => ({
    id: entry.id,
    userId: entry.userId,
    userDisplayName: entry.user.displayName,
    startedAt: entry.startedAt,
    endedAt: entry.endedAt,
    minutes: entry.endedAt ? elapsedMinutes(entry.startedAt, entry.endedAt) : null,
    note: entry.note,
  }));
}

/** The acting user's running timer in this organization, if any. */
export async function runningTimer(
  input: TimeEntryServiceInput,
): Promise<Readonly<{ entryId: string; workOrderId: string; startedAt: Date }> | null> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.read",
  );

  const entry = await input.db.timeEntry.findFirst({
    where: {
      organizationId: input.context.organizationId,
      userId: input.context.actorId,
      endedAt: null,
    },
    select: { id: true, workOrderId: true, startedAt: true },
  });
  return entry
    ? { entryId: entry.id, workOrderId: entry.workOrderId, startedAt: entry.startedAt }
    : null;
}

/**
 * Deletes an entry — the correction path for mistakes. Deleting a running
 * timer stops it from history entirely; prefer stopTimer for normal flows.
 */
export async function deleteTimeEntry(
  input: TimeEntryServiceInput & { entryId: string },
): Promise<void> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );

  await input.db.$transaction(async (transaction) => {
    const entry = await transaction.timeEntry.findFirst({
      where: { id: input.entryId, organizationId: input.context.organizationId },
      select: { id: true, workOrderId: true, locationId: true },
    });
    if (!entry) throw new TimeEntryFailed("entry_not_found");

    await transaction.timeEntry.delete({ where: { id: entry.id } });

    await transaction.activityEvent.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        locationId: entry.locationId,
        workOrderId: entry.workOrderId,
        actorUserId: input.context.actorId,
        eventType: "time.deleted",
        summary: "Time entry deleted.",
      },
    });
  });
}
