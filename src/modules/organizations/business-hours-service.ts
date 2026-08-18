import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import { assertTenantAccess, type TenantContext } from "@/modules/tenancy/policy";

export type HoursServiceInput = Readonly<{ db: PrismaClient; context: TenantContext }>;

export class BusinessHoursFailed extends Error {
  constructor(
    public readonly reason:
      | "location_not_found"
      | "invalid_weekday"
      | "invalid_window"
      | "outside_business_hours"
      | "slot_capacity_exceeded"
      | "hours_not_configured",
  ) {
    super("The business hours operation could not be completed.");
    this.name = "BusinessHoursFailed";
  }
}

export type BusinessHourWindow = Readonly<{
  weekday: number;
  openMinute: number;
  closeMinute: number;
}>;

export type BusinessHoursConfig = Readonly<{
  hours: readonly BusinessHourWindow[];
  slotMinutes: number;
  bookingCapacity: number;
}>;

/** Reads a location's weekly hours and booking slot settings. */
export async function getBusinessHours(
  db: PrismaClient,
  context: TenantContext,
  locationId: string,
): Promise<BusinessHoursConfig> {
  assertTenantAccess(context, { organizationId: context.organizationId }, "work_orders.read");

  const location = await db.location.findFirst({
    where: { id: locationId, organizationId: context.organizationId },
    select: {
      slotMinutes: true,
      bookingCapacity: true,
      businessHours: {
        orderBy: { weekday: "asc" },
        select: { weekday: true, openMinute: true, closeMinute: true },
      },
    },
  });
  if (!location) throw new BusinessHoursFailed("location_not_found");

  return {
    hours: location.businessHours,
    slotMinutes: location.slotMinutes,
    bookingCapacity: location.bookingCapacity,
  };
}

/** Replaces the location's weekly hours (one window per weekday, 0=Mon..6=Sun). */
export async function replaceBusinessHours(
  db: PrismaClient,
  context: TenantContext,
  locationId: string,
  hours: ReadonlyArray<Readonly<{ weekday: number; openMinute: number; closeMinute: number }>>,
): Promise<void> {
  assertTenantAccess(context, { organizationId: context.organizationId }, "organizations.manage");

  for (const window of hours) {
    if (!Number.isInteger(window.weekday) || window.weekday < 0 || window.weekday > 6) {
      throw new BusinessHoursFailed("invalid_weekday");
    }
    if (
      !Number.isInteger(window.openMinute) ||
      !Number.isInteger(window.closeMinute) ||
      window.openMinute < 0 ||
      window.openMinute >= 1440 ||
      window.closeMinute <= 0 ||
      window.closeMinute > 1440 ||
      window.closeMinute <= window.openMinute
    ) {
      throw new BusinessHoursFailed("invalid_window");
    }
  }
  const weekdays = new Set(hours.map((window) => window.weekday));
  if (weekdays.size !== hours.length) throw new BusinessHoursFailed("invalid_weekday");

  await db.$transaction(async (transaction) => {
    const location = await transaction.location.findFirst({
      where: { id: locationId, organizationId: context.organizationId },
      select: { id: true },
    });
    if (!location) throw new BusinessHoursFailed("location_not_found");

    await transaction.locationBusinessHour.deleteMany({
      where: { organizationId: context.organizationId, locationId: location.id },
    });
    for (const window of hours) {
      await transaction.locationBusinessHour.create({
        data: {
          id: randomUUID(),
          organizationId: context.organizationId,
          locationId: location.id,
          weekday: window.weekday,
          openMinute: window.openMinute,
          closeMinute: window.closeMinute,
        },
      });
    }
  });
}

/** Updates slot length and concurrent-booking capacity. */
export async function updateBookingSettings(
  db: PrismaClient,
  context: TenantContext,
  locationId: string,
  input: Readonly<{ slotMinutes: number; bookingCapacity: number }>,
): Promise<void> {
  assertTenantAccess(context, { organizationId: context.organizationId }, "organizations.manage");

  if (
    !Number.isInteger(input.slotMinutes) ||
    input.slotMinutes < 15 ||
    input.slotMinutes > 480 ||
    !Number.isInteger(input.bookingCapacity) ||
    input.bookingCapacity < 1 ||
    input.bookingCapacity > 50
  ) {
    throw new BusinessHoursFailed("invalid_window");
  }

  const update = await db.location.updateMany({
    where: { id: locationId, organizationId: context.organizationId },
    data: { slotMinutes: input.slotMinutes, bookingCapacity: input.bookingCapacity },
  });
  if (update.count !== 1) throw new BusinessHoursFailed("location_not_found");
}

/**
 * Booking guard for appointment create/reschedule: the visit must start and
 * end inside the location's weekday hours, and overlapping active
 * appointments must not exceed capacity. Checked in the location's own time
 * zone so 9:00 means 9:00 at the shop.
 */
export async function assertWithinBookingRules(
  db: Pick<PrismaClient, "location" | "appointment">,
  context: TenantContext,
  input: Readonly<{
    locationId: string;
    startAt: Date;
    endAt: Date;
    excludeAppointmentId?: string;
  }>,
): Promise<void> {
  const location = await db.location.findFirst({
    where: { id: input.locationId, organizationId: context.organizationId },
    select: {
      id: true,
      timeZone: true,
      slotMinutes: true,
      bookingCapacity: true,
      businessHours: { select: { weekday: true, openMinute: true, closeMinute: true } },
    },
  });
  if (!location) throw new BusinessHoursFailed("location_not_found");
  if (location.businessHours.length === 0) return; // unconfigured = unrestricted

  const zone = location.timeZone;
  const parts = (instant: Date) => {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      weekday: "short",
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    });
    const map = new Map(fmt.formatToParts(instant).map((p) => [p.type, p.value]));
    const weekdayName = map.get("weekday") ?? "";
    // JS getDay convention: 0 = Sunday … 6 = Saturday, matching the stored
    // weekday values (documented on LocationBusinessHour.weekday).
    const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekdayName);
    const hour = Number(map.get("hour") ?? "0") % 24;
    const minute = Number(map.get("minute") ?? "0");
    return { weekday, minuteOfDay: hour * 60 + minute };
  };

  const start = parts(input.startAt);
  const end = parts(input.endAt);

  const startWindow = location.businessHours.find((w) => w.weekday === start.weekday);
  // Same-day visits only: an appointment spanning midnight is rejected.
  if (!startWindow || end.weekday !== start.weekday) {
    throw new BusinessHoursFailed("outside_business_hours");
  }
  if (start.minuteOfDay < startWindow.openMinute || end.minuteOfDay > startWindow.closeMinute) {
    throw new BusinessHoursFailed("outside_business_hours");
  }

  // Capacity: active appointments overlapping this window at this location.
  const overlapping = await db.appointment.count({
    where: {
      organizationId: context.organizationId,
      locationId: location.id,
      status: { in: ["SCHEDULED", "CONFIRMED", "CHECKED_IN"] },
      startAt: { lt: input.endAt },
      endAt: { gt: input.startAt },
      ...(input.excludeAppointmentId ? { id: { not: input.excludeAppointmentId } } : {}),
    },
  });
  if (overlapping >= location.bookingCapacity) {
    throw new BusinessHoursFailed("slot_capacity_exceeded");
  }
  void location.slotMinutes;
}
