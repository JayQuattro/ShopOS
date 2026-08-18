import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import { assertTenantAccess, type TenantContext } from "@/modules/tenancy/policy";
import type { TransactionalClient } from "@/modules/estimates/estimate-service";
import { WorkOrderRepository } from "@/modules/work-orders/work-order-repository";
import { assertWithinBookingRules } from "@/modules/organizations/business-hours-service";

export type AppointmentServiceInput = Readonly<{ db: PrismaClient; context: TenantContext }>;

export class AppointmentFailed extends Error {
  constructor(
    public readonly reason:
      | "appointment_not_found"
      | "customer_not_found"
      | "asset_not_found"
      | "location_not_found"
      | "invalid_time_range"
      | "invalid_reason"
      | "invalid_transition"
      | "already_converted",
  ) {
    super("The appointment operation could not be completed.");
    this.name = "AppointmentFailed";
  }
}

export type AppointmentStatusValue =
  "SCHEDULED" | "CONFIRMED" | "CHECKED_IN" | "COMPLETED" | "CANCELLED" | "NO_SHOW";

/** Appointment lifecycle: cancel is possible until check-in; completion follows check-in. */
const APPOINTMENT_TRANSITIONS: Readonly<
  Record<AppointmentStatusValue, ReadonlySet<AppointmentStatusValue>>
> = {
  SCHEDULED: new Set(["CONFIRMED", "CHECKED_IN", "CANCELLED", "NO_SHOW"]),
  CONFIRMED: new Set(["CHECKED_IN", "CANCELLED", "NO_SHOW"]),
  CHECKED_IN: new Set(["COMPLETED"]),
  COMPLETED: new Set(),
  CANCELLED: new Set(),
  NO_SHOW: new Set(),
};

export function canTransitionAppointment(
  from: AppointmentStatusValue,
  to: AppointmentStatusValue,
): boolean {
  return APPOINTMENT_TRANSITIONS[from].has(to);
}

/**
 * Creates an appointment. Times are UTC instants; the UI renders them in the
 * location's IANA time zone. Permissions reuse work_orders.* — appointments
 * are the front end of work orders.
 */
export async function createAppointment(
  input: AppointmentServiceInput & {
    locationId: string;
    customerId: string;
    assetId?: string;
    reason: string;
    notes?: string;
    startAt: Date;
    endAt: Date;
  },
): Promise<Readonly<{ appointmentId: string }>> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId, locationId: input.locationId },
    "work_orders.write",
  );

  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 500) throw new AppointmentFailed("invalid_reason");
  if (input.endAt <= input.startAt) throw new AppointmentFailed("invalid_time_range");

  return input.db.$transaction(async (transaction) => {
    const [customer, location] = await Promise.all([
      transaction.customer.findFirst({
        where: { id: input.customerId, organizationId: input.context.organizationId },
        select: { id: true },
      }),
      transaction.location.findFirst({
        where: { id: input.locationId, organizationId: input.context.organizationId },
        select: { id: true },
      }),
    ]);
    if (!customer) throw new AppointmentFailed("customer_not_found");
    if (!location) throw new AppointmentFailed("location_not_found");

    // Business hours + capacity (settings); unconfigured locations are
    // unrestricted, so existing shops keep working.
    await assertWithinBookingRules(transaction, input.context, {
      locationId: input.locationId,
      startAt: input.startAt,
      endAt: input.endAt,
    });

    // A nested tenant check: the asset must belong to this customer in this org.
    if (input.assetId) {
      const asset = await transaction.asset.findFirst({
        where: {
          id: input.assetId,
          organizationId: input.context.organizationId,
          customerId: input.customerId,
        },
        select: { id: true },
      });
      if (!asset) throw new AppointmentFailed("asset_not_found");
    }

    const appointment = await transaction.appointment.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        locationId: input.locationId,
        customerId: input.customerId,
        ...(input.assetId ? { assetId: input.assetId } : {}),
        reason,
        ...(input.notes ? { notes: input.notes } : {}),
        startAt: input.startAt,
        endAt: input.endAt,
        createdByUserId: input.context.actorId,
      },
    });

    await transaction.auditEvent.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        locationId: input.locationId,
        actorUserId: input.context.actorId,
        action: "appointment.created",
        entityType: "appointment",
        entityId: appointment.id,
        requestId: input.context.requestId,
        after: { startAt: input.startAt.toISOString(), endAt: input.endAt.toISOString() },
      },
    });

    return { appointmentId: appointment.id };
  });
}

export async function rescheduleAppointment(
  input: AppointmentServiceInput & { appointmentId: string; startAt: Date; endAt: Date },
): Promise<void> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );

  if (input.endAt <= input.startAt) throw new AppointmentFailed("invalid_time_range");

  await input.db.$transaction(async (transaction) => {
    const appointment = await loadAppointment(transaction, input.context, input.appointmentId);
    if (appointment.status !== "SCHEDULED" && appointment.status !== "CONFIRMED") {
      throw new AppointmentFailed("invalid_transition");
    }

    await transaction.appointment.update({
      where: { id: appointment.id },
      data: { startAt: input.startAt, endAt: input.endAt },
    });

    await transaction.auditEvent.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        locationId: appointment.locationId,
        actorUserId: input.context.actorId,
        action: "appointment.rescheduled",
        entityType: "appointment",
        entityId: appointment.id,
        requestId: input.context.requestId,
        before: { startAt: appointment.startAt.toISOString() },
        after: { startAt: input.startAt.toISOString() },
      },
    });
  });
}

export async function transitionAppointment(
  input: AppointmentServiceInput & { appointmentId: string; targetStatus: AppointmentStatusValue },
): Promise<void> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );

  await input.db.$transaction(async (transaction) => {
    const appointment = await loadAppointment(transaction, input.context, input.appointmentId);
    if (!canTransitionAppointment(appointment.status, input.targetStatus)) {
      throw new AppointmentFailed("invalid_transition");
    }

    await transaction.appointment.update({
      where: { id: appointment.id },
      data: { status: input.targetStatus },
    });

    await transaction.auditEvent.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        locationId: appointment.locationId,
        actorUserId: input.context.actorId,
        action: "appointment.status_changed",
        entityType: "appointment",
        entityId: appointment.id,
        requestId: input.context.requestId,
        before: { status: appointment.status },
        after: { status: input.targetStatus },
      },
    });
  });
}

/**
 * Converts a checked-in appointment into a work order and links it. The work
 * order inherits the customer, asset, location, and the appointment reason as
 * the initial customer concern.
 */
export async function convertAppointmentToWorkOrder(
  input: AppointmentServiceInput & { appointmentId: string },
): Promise<Readonly<{ workOrderId: string; number: string }>> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );

  const appointment = await loadAppointment(input.db, input.context, input.appointmentId);
  if (appointment.workOrderId) throw new AppointmentFailed("already_converted");
  if (appointment.status !== "CHECKED_IN") throw new AppointmentFailed("invalid_transition");

  const repository = new WorkOrderRepository({ db: input.db, context: input.context });
  const workOrder = await repository.create({
    customerId: appointment.customerId,
    locationId: appointment.locationId,
    ...(appointment.assetId ? { assetId: appointment.assetId } : {}),
    customerConcern: appointment.reason,
    promisedAt: appointment.endAt,
  });

  await input.db.appointment.update({
    where: { id: appointment.id },
    data: { workOrderId: workOrder.id },
  });

  return { workOrderId: workOrder.id, number: workOrder.number };
}

export type AppointmentSummary = Readonly<{
  id: string;
  status: AppointmentStatusValue;
  reason: string;
  notes: string | null;
  startAt: Date;
  endAt: Date;
  customerId: string;
  customerName: string;
  assetId: string | null;
  assetName: string | null;
  workOrderId: string | null;
  locationId: string;
}>;

/**
 * Lists appointments overlapping a UTC time range, scoped to the authorized
 * organization and (when the actor is location-limited) locations.
 */
export async function listAppointmentsInRange(
  input: AppointmentServiceInput & { from: Date; to: Date },
): Promise<readonly AppointmentSummary[]> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.read",
  );

  const appointments = await input.db.appointment.findMany({
    where: {
      organizationId: input.context.organizationId,
      startAt: { lt: input.to },
      endAt: { gt: input.from },
      ...(input.context.organizationWideLocationAccess
        ? {}
        : { locationId: { in: [...input.context.allowedLocationIds] } }),
    },
    orderBy: { startAt: "asc" },
    select: {
      id: true,
      status: true,
      reason: true,
      notes: true,
      startAt: true,
      endAt: true,
      customerId: true,
      assetId: true,
      workOrderId: true,
      locationId: true,
      customer: { select: { displayName: true } },
      asset: { select: { displayName: true } },
    },
  });

  return appointments.map((appointment) => ({
    id: appointment.id,
    status: appointment.status as AppointmentStatusValue,
    reason: appointment.reason,
    notes: appointment.notes,
    startAt: appointment.startAt,
    endAt: appointment.endAt,
    customerId: appointment.customerId,
    customerName: appointment.customer.displayName,
    assetId: appointment.assetId,
    assetName: appointment.asset?.displayName ?? null,
    workOrderId: appointment.workOrderId,
    locationId: appointment.locationId,
  }));
}

async function loadAppointment(
  db: TransactionalClient,
  context: TenantContext,
  appointmentId: string,
) {
  const appointment = await db.appointment.findFirst({
    where: { id: appointmentId, organizationId: context.organizationId },
    select: {
      id: true,
      locationId: true,
      status: true,
      customerId: true,
      assetId: true,
      workOrderId: true,
      reason: true,
      startAt: true,
      endAt: true,
    },
  });
  if (!appointment) throw new AppointmentFailed("appointment_not_found");
  return appointment;
}
