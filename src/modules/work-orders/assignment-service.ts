import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import { assertTenantAccess, type TenantContext } from "@/modules/tenancy/policy";

export type AssignmentServiceInput = Readonly<{ db: PrismaClient; context: TenantContext }>;

export class AssignmentFailed extends Error {
  constructor(public readonly reason: "work_order_not_found" | "technician_not_a_member") {
    super("The assignment operation could not be completed.");
    this.name = "AssignmentFailed";
  }
}

/**
 * Assigns (or re-assigns) the primary technician on a work order. The assignee
 * must be an active member of the same organization — a valid user id from
 * outside the tenant never authorizes assignment.
 */
export async function assignTechnician(
  input: AssignmentServiceInput & { workOrderId: string; userId: string },
): Promise<void> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );

  await input.db.$transaction(async (transaction) => {
    const workOrder = await transaction.workOrder.findFirst({
      where: { id: input.workOrderId, organizationId: input.context.organizationId },
      select: {
        id: true,
        locationId: true,
        number: true,
        assignedTechnicianUserId: true,
        assignedTechnician: { select: { displayName: true } },
      },
    });
    if (!workOrder) throw new AssignmentFailed("work_order_not_found");

    const membership = await transaction.organizationMembership.findFirst({
      where: {
        organizationId: input.context.organizationId,
        userId: input.userId,
        active: true,
      },
      select: { id: true, user: { select: { displayName: true } } },
    });
    if (!membership) throw new AssignmentFailed("technician_not_a_member");

    await transaction.workOrder.update({
      where: { id: workOrder.id },
      data: { assignedTechnicianUserId: input.userId },
    });

    const previous = workOrder.assignedTechnician?.displayName ?? null;
    await transaction.activityEvent.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        locationId: workOrder.locationId,
        workOrderId: workOrder.id,
        actorUserId: input.context.actorId,
        eventType: "work_order.assigned",
        summary: previous
          ? `Technician changed from ${previous} to ${membership.user.displayName}.`
          : `${membership.user.displayName} assigned as technician.`,
      },
    });

    await transaction.auditEvent.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        locationId: workOrder.locationId,
        actorUserId: input.context.actorId,
        action: "work_order.assigned",
        entityType: "work_order",
        entityId: workOrder.id,
        requestId: input.context.requestId,
        before: { assignedTechnicianUserId: workOrder.assignedTechnicianUserId },
        after: { assignedTechnicianUserId: input.userId },
      },
    });
  });
}

/**
 * Clears the technician assignment.
 */
export async function unassignTechnician(
  input: AssignmentServiceInput & { workOrderId: string },
): Promise<void> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );

  await input.db.$transaction(async (transaction) => {
    const workOrder = await transaction.workOrder.findFirst({
      where: { id: input.workOrderId, organizationId: input.context.organizationId },
      select: {
        id: true,
        locationId: true,
        assignedTechnicianUserId: true,
        assignedTechnician: { select: { displayName: true } },
      },
    });
    if (!workOrder) throw new AssignmentFailed("work_order_not_found");
    if (!workOrder.assignedTechnicianUserId) return;

    await transaction.workOrder.update({
      where: { id: workOrder.id },
      data: { assignedTechnicianUserId: null },
    });

    await transaction.activityEvent.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        locationId: workOrder.locationId,
        workOrderId: workOrder.id,
        actorUserId: input.context.actorId,
        eventType: "work_order.unassigned",
        summary: `${workOrder.assignedTechnician?.displayName ?? "Technician"} unassigned.`,
      },
    });

    await transaction.auditEvent.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        locationId: workOrder.locationId,
        actorUserId: input.context.actorId,
        action: "work_order.unassigned",
        entityType: "work_order",
        entityId: workOrder.id,
        requestId: input.context.requestId,
        before: { assignedTechnicianUserId: workOrder.assignedTechnicianUserId },
        after: { assignedTechnicianUserId: null },
      },
    });
  });
}

/**
 * Lists assignable technicians: active organization members who can read work
 * orders. Used by the assignment UI.
 */
export async function listAssignableTechnicians(
  input: AssignmentServiceInput,
): Promise<ReadonlyArray<Readonly<{ userId: string; displayName: string }>>> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.read",
  );

  const memberships = await input.db.organizationMembership.findMany({
    where: { organizationId: input.context.organizationId, active: true },
    select: {
      userId: true,
      user: { select: { displayName: true } },
      roles: { select: { role: { select: { permissions: true } } } },
    },
  });

  return memberships
    .filter((membership) =>
      membership.roles.some((link) =>
        (link.role.permissions as string[]).includes("work_orders.read"),
      ),
    )
    .map((membership) => ({
      userId: membership.userId,
      displayName: membership.user.displayName,
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

// ─── Assisting technicians ──────────────────────────────────────────────────

export class TechnicianTeamFailed extends Error {
  constructor(public readonly reason: "work_order_not_found" | "technician_not_a_member") {
    super("The technician team operation could not be completed.");
    this.name = "TechnicianTeamFailed";
  }
}

/**
 * Replaces the set of assisting technicians (everyone besides the lead).
 * Each user must be an active member of the organization; the lead may also
 * appear here without harm but is excluded from storage for cleanliness.
 */
export async function setAssistingTechnicians(
  input: AssignmentServiceInput & { workOrderId: string; userIds: ReadonlyArray<string> },
): Promise<void> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );

  const uniqueIds = [...new Set(input.userIds)];

  await input.db.$transaction(async (transaction) => {
    const workOrder = await transaction.workOrder.findFirst({
      where: { id: input.workOrderId, organizationId: input.context.organizationId },
      select: {
        id: true,
        locationId: true,
        assignedTechnicianUserId: true,
        assistingTechnicians: { select: { userId: true, user: { select: { displayName: true } } } },
      },
    });
    if (!workOrder) throw new TechnicianTeamFailed("work_order_not_found");

    for (const userId of uniqueIds) {
      const membership = await transaction.organizationMembership.findFirst({
        where: { organizationId: input.context.organizationId, userId, active: true },
        select: { id: true },
      });
      if (!membership) throw new TechnicianTeamFailed("technician_not_a_member");
    }

    const previousNames = workOrder.assistingTechnicians.map((entry) => entry.user.displayName);

    await transaction.workOrderTechnician.deleteMany({
      where: { organizationId: input.context.organizationId, workOrderId: workOrder.id },
    });
    for (const userId of uniqueIds) {
      if (userId === workOrder.assignedTechnicianUserId) continue;
      await transaction.workOrderTechnician.create({
        data: {
          id: randomUUID(),
          organizationId: input.context.organizationId,
          workOrderId: workOrder.id,
          userId,
        },
      });
    }

    const names = await Promise.all(
      uniqueIds
        .filter((userId) => userId !== workOrder.assignedTechnicianUserId)
        .map(async (userId) => {
          const user = await transaction.user.findUnique({
            where: { id: userId },
            select: { displayName: true },
          });
          return user?.displayName ?? "Technician";
        }),
    );

    if (names.join(",") !== previousNames.join(",")) {
      await transaction.activityEvent.create({
        data: {
          id: randomUUID(),
          organizationId: input.context.organizationId,
          locationId: workOrder.locationId,
          workOrderId: workOrder.id,
          actorUserId: input.context.actorId,
          eventType: "work_order.technicians_updated",
          summary:
            names.length > 0
              ? `Also working: ${names.join(", ")}.`
              : "Assisting technicians cleared.",
        },
      });
    }
  });
}

export async function listAssistingTechnicians(
  input: AssignmentServiceInput & { workOrderId: string },
): Promise<ReadonlyArray<Readonly<{ userId: string; displayName: string }>>> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.read",
  );

  const rows = await input.db.workOrderTechnician.findMany({
    where: { organizationId: input.context.organizationId, workOrderId: input.workOrderId },
    orderBy: { createdAt: "asc" },
    select: { userId: true, user: { select: { displayName: true } } },
  });
  return rows.map((row) => ({ userId: row.userId, displayName: row.user.displayName }));
}
