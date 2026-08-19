import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";

type TransactionalClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$use" | "$extends"
>;
import { assertTenantAccess, type TenantContext } from "@/modules/tenancy/policy";

export type HolidayServiceInput = Readonly<{ db: PrismaClient; context: TenantContext }>;

export class HolidayFailed extends Error {
  constructor(
    public readonly reason: "invalid_date" | "invalid_name" | "not_found" | "location_not_found",
  ) {
    super("The holiday operation could not be completed.");
    this.name = "HolidayFailed";
  }
}

export type Holiday = Readonly<{
  id: string;
  locationId: string;
  date: string; // YYYY-MM-DD, local to the location
  name: string;
  closesAllDay: boolean;
}>;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function normalizeDate(input: string): string {
  const trimmed = input.trim();
  if (!DATE_PATTERN.test(trimmed) || Number.isNaN(Date.parse(`${trimmed}T00:00:00Z`))) {
    throw new HolidayFailed("invalid_date");
  }
  return trimmed;
}

function toIso(row: { date: Date }): string {
  return row.date.toISOString().slice(0, 10);
}

/**
 * Lists a location's holidays in a date window (inclusive), ascending.
 */
export async function listHolidays(
  input: HolidayServiceInput & { locationId: string; from: string; to: string },
): Promise<readonly Holiday[]> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId, locationId: input.locationId },
    "work_orders.read",
  );

  const rows = await input.db.locationHoliday.findMany({
    where: {
      organizationId: input.context.organizationId,
      locationId: input.locationId,
      date: {
        gte: new Date(`${normalizeDate(input.from)}T00:00:00Z`),
        lte: new Date(`${normalizeDate(input.to)}T00:00:00Z`),
      },
    },
    orderBy: { date: "asc" },
    select: { id: true, locationId: true, date: true, name: true, closesAllDay: true },
  });

  return rows.map((row) => ({
    id: row.id,
    locationId: row.locationId,
    date: toIso(row),
    name: row.name,
    closesAllDay: row.closesAllDay,
  }));
}

/**
 * Adds or replaces the holiday for a date (one row per location per day).
 */
export async function upsertHoliday(
  input: HolidayServiceInput & {
    locationId: string;
    date: string;
    name: string;
    closesAllDay?: boolean;
  },
): Promise<Readonly<{ holidayId: string }>> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId, locationId: input.locationId },
    "organizations.manage",
  );

  const date = normalizeDate(input.date);
  const name = input.name.trim();
  if (name.length < 2 || name.length > 120) throw new HolidayFailed("invalid_name");

  const location = await input.db.location.findFirst({
    where: { id: input.locationId, organizationId: input.context.organizationId },
    select: { id: true },
  });
  if (!location) throw new HolidayFailed("location_not_found");

  const row = await input.db.locationHoliday.upsert({
    where: {
      organizationId_locationId_date: {
        organizationId: input.context.organizationId,
        locationId: input.locationId,
        date: new Date(`${date}T00:00:00Z`),
      },
    },
    update: {
      name,
      ...(input.closesAllDay !== undefined ? { closesAllDay: input.closesAllDay } : {}),
    },
    create: {
      id: randomUUID(),
      organizationId: input.context.organizationId,
      locationId: input.locationId,
      date: new Date(`${date}T00:00:00Z`),
      name,
      ...(input.closesAllDay !== undefined ? { closesAllDay: input.closesAllDay } : {}),
    },
    select: { id: true },
  });
  return { holidayId: row.id };
}

export async function deleteHoliday(
  input: HolidayServiceInput & { holidayId: string },
): Promise<void> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "organizations.manage",
  );

  const deleted = await input.db.locationHoliday.deleteMany({
    where: { id: input.holidayId, organizationId: input.context.organizationId },
  });
  if (deleted.count !== 1) throw new HolidayFailed("not_found");
}

/**
 * The booking guard's question: is this location closed all day on this
 * local date, and why? Partial-day holidays (closesAllDay false) do not
 * block booking — business hours still govern.
 */
export async function allDayClosureOn(
  db: PrismaClient | TransactionalClient,
  organizationId: string,
  locationId: string,
  localDate: string,
): Promise<Readonly<{ name: string }> | null> {
  const holiday = await db.locationHoliday.findFirst({
    where: {
      organizationId,
      locationId,
      date: new Date(`${normalizeDate(localDate)}T00:00:00Z`),
      closesAllDay: true,
    },
    select: { name: true },
  });
  return holiday ?? null;
}
