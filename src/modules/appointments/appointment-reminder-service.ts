import type { PrismaClient } from "@/generated/prisma/client";
import { sendCustomerSms } from "@/modules/integrations/sms/sms-service";

/**
 * Appointment reminders (ADR 0008-style background work): a sweep enqueues
 * outbox events for appointments that need action, and handlers send the
 * texts. The sweep is idempotent via a per-appointment reminder state row
 * keyed on the appointment itself (stored in Appointment.notes is unsafe, so
 * we use the activity-free approach: a dedicated small table would be ideal;
 * for now the sweep enqueues at most one event per appointment per day by
 * checking the outbox for an existing event with the same aggregate id and a
 * marker payload flag).
 */
export type ReminderTarget = Readonly<{
  appointmentId: string;
  organizationId: string;
  customerId: string;
  customerName: string;
  phone: string | null;
  reason: string;
  startAt: Date;
  locationTimeZone: string;
}>;

type Candidate = {
  id: string;
  organizationId: string;
  customerId: string;
  reason: string;
  startAt: Date;
  status: string;
  customer: { displayName: string; primaryPhone: string | null };
  location: { timeZone: string };
};

function hasPhone(candidate: Candidate): boolean {
  return Boolean(candidate.customer.primaryPhone);
}

/** Appointments starting tomorrow that need a reminder text. */
export async function findRemindersDue(
  db: PrismaClient,
  now: Date,
): Promise<readonly ReminderTarget[]> {
  const from = new Date(now.getTime() + 20 * 60 * 60 * 1000);
  const to = new Date(now.getTime() + 32 * 60 * 60 * 1000);

  const appointments = await db.appointment.findMany({
    where: {
      status: { in: ["SCHEDULED", "CONFIRMED"] },
      startAt: { gte: from, lte: to },
    },
    select: {
      id: true,
      organizationId: true,
      customerId: true,
      reason: true,
      startAt: true,
      status: true,
      customer: { select: { displayName: true, primaryPhone: true } },
      location: { select: { timeZone: true } },
    },
  });

  return appointments
    .filter((appointment): appointment is Candidate & typeof appointment => hasPhone(appointment))
    .map((appointment) => ({
      appointmentId: appointment.id,
      organizationId: appointment.organizationId,
      customerId: appointment.customerId,
      customerName: appointment.customer.displayName,
      phone: appointment.customer.primaryPhone!,
      reason: appointment.reason,
      startAt: appointment.startAt,
      locationTimeZone: appointment.location.timeZone,
    }));
}

/** Appointments still SCHEDULED/CONFIRMED well past their start: no-shows. */
export async function findNoShows(db: PrismaClient, now: Date): Promise<readonly ReminderTarget[]> {
  const cutoff = new Date(now.getTime() - 2 * 60 * 60 * 1000);

  const appointments = await db.appointment.findMany({
    where: {
      status: { in: ["SCHEDULED", "CONFIRMED"] },
      startAt: { lt: cutoff },
    },
    orderBy: { startAt: "asc" },
    take: 20,
    select: {
      id: true,
      organizationId: true,
      customerId: true,
      reason: true,
      startAt: true,
      status: true,
      customer: { select: { displayName: true, primaryPhone: true } },
      location: { select: { timeZone: true } },
    },
  });

  return appointments
    .filter((appointment): appointment is Candidate & typeof appointment => hasPhone(appointment))
    .map((appointment) => ({
      appointmentId: appointment.id,
      organizationId: appointment.organizationId,
      customerId: appointment.customerId,
      customerName: appointment.customer.displayName,
      phone: appointment.customer.primaryPhone!,
      reason: appointment.reason,
      startAt: appointment.startAt,
      locationTimeZone: appointment.location.timeZone,
    }));
}

/**
 * Sends a reminder text directly (sweep may call this instead of going
 * through the outbox when running in-process). Records the message on the
 * customer's thread.
 */
export async function sendAppointmentReminder(
  db: PrismaClient,
  target: ReminderTarget,
  kind: "reminder" | "no_show",
  organizationName: string,
): Promise<boolean> {
  const systemContext = {
    actorId: target.customerId,
    organizationId: target.organizationId,
    membershipId: "00000000-0000-4000-8000-000000000000",
    requestId: `appointment-${kind}:${target.appointmentId}`,
    organizationWideLocationAccess: true,
    allowedLocationIds: new Set<string>(),
    permissions: new Set(["customers.write"] as const),
  } as import("@/modules/tenancy/policy").TenantContext;

  const time = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    hour: "numeric",
    minute: "2-digit",
    timeZone: target.locationTimeZone,
  }).format(target.startAt);

  try {
    await sendCustomerSms({
      db,
      context: systemContext,
      customerId: target.customerId,
      to: target.phone!,
      body:
        kind === "reminder"
          ? `Reminder from ${organizationName}: your appointment for ${target.reason} is tomorrow, ${time}. Reply to reschedule.`
          : `We missed you at your ${target.reason} appointment. Want to reschedule? — ${organizationName}`,
    });
    return true;
  } catch {
    return false; // Not configured or invalid — skip silently; sweep will retry next pass.
  }
}
