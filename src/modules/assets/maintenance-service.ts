import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import { assertTenantAccess, type TenantContext } from "@/modules/tenancy/policy";
import { sendCustomerSms } from "@/modules/integrations/sms/sms-service";

export type PmServiceInput = Readonly<{ db: PrismaClient; context: TenantContext }>;

export class PmFailed extends Error {
  constructor(
    public readonly reason:
      | "asset_not_found"
      | "schedule_not_found"
      | "invalid_name"
      | "invalid_interval"
      | "duplicate_schedule",
  ) {
    super("The maintenance schedule operation could not be completed.");
    this.name = "PmFailed";
  }
}

export type ScheduleDueState = "due" | "due_soon" | "ok";

export type MaintenanceScheduleSummary = Readonly<{
  id: string;
  assetId: string;
  assetName: string;
  customerId: string;
  customerName: string;
  customerPhone: string | null;
  name: string;
  intervalMiles: number | null;
  intervalMonths: number | null;
  lastServicedAt: Date | null;
  lastServicedMileage: number | null;
  lastRemindedAt: Date | null;
  active: boolean;
  mileage: number | null;
  dueState: ScheduleDueState;
  monthsElapsed: number | null;
  milesElapsed: number | null;
}>;

const MILEAGE_DUE_SOON_FACTOR = 0.9;
const MONTH_DUE_SOON_FACTOR = 0.9;

/** Evaluates one schedule's due state against the asset's known mileage and now. */
export function evaluateDueState(
  schedule: Readonly<{
    intervalMiles: number | null;
    intervalMonths: number | null;
    lastServicedAt: Date | null;
    lastServicedMileage: number | null;
  }>,
  mileage: number | null,
  now: Date,
): { dueState: ScheduleDueState; monthsElapsed: number | null; milesElapsed: number | null } {
  const monthsElapsed = schedule.lastServicedAt
    ? (now.getTime() - schedule.lastServicedAt.getTime()) / (30.44 * 24 * 60 * 60 * 1000)
    : null;
  const milesElapsed =
    mileage !== null && schedule.lastServicedMileage !== null
      ? mileage - schedule.lastServicedMileage
      : null;

  const milesDue =
    schedule.intervalMiles !== null &&
    milesElapsed !== null &&
    milesElapsed >= schedule.intervalMiles;
  const monthsDue =
    schedule.intervalMonths !== null &&
    monthsElapsed !== null &&
    monthsElapsed >= schedule.intervalMonths;
  if (milesDue || monthsDue) return { dueState: "due", monthsElapsed, milesElapsed };

  const milesSoon =
    schedule.intervalMiles !== null &&
    milesElapsed !== null &&
    milesElapsed >= schedule.intervalMiles * MILEAGE_DUE_SOON_FACTOR;
  const monthsSoon =
    schedule.intervalMonths !== null &&
    monthsElapsed !== null &&
    monthsElapsed >= schedule.intervalMonths * MONTH_DUE_SOON_FACTOR;
  if (milesSoon || monthsSoon) return { dueState: "due_soon", monthsElapsed, milesElapsed };

  return { dueState: "ok", monthsElapsed, milesElapsed };
}

/**
 * Creates a maintenance schedule on an asset: a named recurring service with
 * a mileage and/or time interval. Last-serviced values seed the due math.
 */
export async function createSchedule(
  input: PmServiceInput & {
    assetId: string;
    name: string;
    intervalMiles?: number;
    intervalMonths?: number;
    lastServicedAt?: Date;
    lastServicedMileage?: number;
  },
): Promise<Readonly<{ scheduleId: string }>> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "assets.write",
  );

  const name = input.name.trim();
  if (name.length < 2 || name.length > 120) throw new PmFailed("invalid_name");
  if (!input.intervalMiles && !input.intervalMonths) throw new PmFailed("invalid_interval");
  if (
    (input.intervalMiles !== undefined && input.intervalMiles < 1) ||
    (input.intervalMonths !== undefined && input.intervalMonths < 1)
  ) {
    throw new PmFailed("invalid_interval");
  }

  const asset = await input.db.asset.findFirst({
    where: { id: input.assetId, organizationId: input.context.organizationId },
    select: { id: true },
  });
  if (!asset) throw new PmFailed("asset_not_found");

  const existing = await input.db.maintenanceSchedule.findFirst({
    where: { organizationId: input.context.organizationId, assetId: asset.id, name },
    select: { id: true },
  });
  if (existing) throw new PmFailed("duplicate_schedule");

  const schedule = await input.db.maintenanceSchedule.create({
    data: {
      id: randomUUID(),
      organizationId: input.context.organizationId,
      assetId: asset.id,
      name,
      ...(input.intervalMiles ? { intervalMiles: input.intervalMiles } : {}),
      ...(input.intervalMonths ? { intervalMonths: input.intervalMonths } : {}),
      ...(input.lastServicedAt ? { lastServicedAt: input.lastServicedAt } : {}),
      ...(input.lastServicedMileage !== undefined
        ? { lastServicedMileage: input.lastServicedMileage }
        : {}),
    },
  });
  return { scheduleId: schedule.id };
}

/** Marks a schedule serviced now, optionally at the current mileage. */
export async function markServiced(
  input: PmServiceInput & { scheduleId: string; mileage?: number },
): Promise<void> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "assets.write",
  );

  await input.db.$transaction(async (transaction) => {
    const schedule = await transaction.maintenanceSchedule.findFirst({
      where: { id: input.scheduleId, organizationId: input.context.organizationId },
      select: { id: true, assetId: true },
    });
    if (!schedule) throw new PmFailed("schedule_not_found");

    await transaction.maintenanceSchedule.update({
      where: { id: schedule.id },
      data: {
        lastServicedAt: new Date(),
        ...(input.mileage !== undefined ? { lastServicedMileage: input.mileage } : {}),
        lastRemindedAt: null,
      },
    });

    // Recording the odometer keeps the asset's known mileage fresh.
    if (input.mileage !== undefined) {
      await transaction.automotiveAssetProfile.upsert({
        where: { assetId: schedule.assetId },
        update: { lastKnownMileage: input.mileage },
        create: { assetId: schedule.assetId, lastKnownMileage: input.mileage },
      });
    }
  });
}

export async function deleteSchedule(
  input: PmServiceInput & { scheduleId: string },
): Promise<void> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "assets.write",
  );

  const schedule = await input.db.maintenanceSchedule.findFirst({
    where: { id: input.scheduleId, organizationId: input.context.organizationId },
    select: { id: true },
  });
  if (!schedule) throw new PmFailed("schedule_not_found");
  await input.db.maintenanceSchedule.delete({ where: { id: schedule.id } });
}

/** Lists schedules for one asset (the asset page's maintenance section). */
export async function listSchedulesForAsset(
  input: PmServiceInput & { assetId: string },
): Promise<readonly MaintenanceScheduleSummary[]> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "assets.read",
  );

  const rows = await input.db.maintenanceSchedule.findMany({
    where: { organizationId: input.context.organizationId, assetId: input.assetId },
    orderBy: { name: "asc" },
    select: {
      id: true,
      assetId: true,
      name: true,
      intervalMiles: true,
      intervalMonths: true,
      lastServicedAt: true,
      lastServicedMileage: true,
      lastRemindedAt: true,
      active: true,
      asset: {
        select: {
          displayName: true,
          customerId: true,
          customer: { select: { displayName: true, primaryPhone: true } },
          automotiveProfile: { select: { lastKnownMileage: true } },
        },
      },
    },
  });

  const now = new Date();
  return rows.map((row) => {
    const mileage = row.asset.automotiveProfile?.lastKnownMileage ?? null;
    const { dueState, monthsElapsed, milesElapsed } = evaluateDueState(row, mileage, now);
    return {
      id: row.id,
      assetId: row.assetId,
      assetName: row.asset.displayName,
      customerId: row.asset.customerId,
      customerName: row.asset.customer.displayName,
      customerPhone: row.asset.customer.primaryPhone,
      name: row.name,
      intervalMiles: row.intervalMiles,
      intervalMonths: row.intervalMonths,
      lastServicedAt: row.lastServicedAt,
      lastServicedMileage: row.lastServicedMileage,
      lastRemindedAt: row.lastRemindedAt,
      active: row.active,
      mileage,
      dueState,
      monthsElapsed: monthsElapsed !== null ? Math.floor(monthsElapsed) : null,
      milesElapsed,
    };
  });
}

export type DueSweepTarget = Readonly<{
  scheduleId: string;
  organizationId: string;
  customerId: string;
  customerPhone: string | null;
  assetName: string;
  scheduleName: string;
  dueState: ScheduleDueState;
}>;

/**
 * Sweep target list: due (or due-soon) schedules whose customer has a phone
 * and who haven't been reminded in the last 30 days.
 */
export async function findDueForReminders(
  db: PrismaClient,
  now: Date,
): Promise<readonly DueSweepTarget[]> {
  const rows = await db.maintenanceSchedule.findMany({
    where: { active: true },
    select: {
      id: true,
      organizationId: true,
      name: true,
      intervalMiles: true,
      intervalMonths: true,
      lastServicedAt: true,
      lastServicedMileage: true,
      lastRemindedAt: true,
      asset: {
        select: {
          displayName: true,
          customerId: true,
          customer: { select: { displayName: true, primaryPhone: true } },
          automotiveProfile: { select: { lastKnownMileage: true } },
        },
      },
    },
    take: 500,
  });

  const remindCutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const targets: DueSweepTarget[] = [];
  for (const row of rows) {
    const phone = row.asset.customer.primaryPhone;
    if (!phone) continue;
    if (row.lastRemindedAt && row.lastRemindedAt > remindCutoff) continue;
    const mileage = row.asset.automotiveProfile?.lastKnownMileage ?? null;
    const { dueState } = evaluateDueState(row, mileage, now);
    if (dueState === "ok") continue;
    targets.push({
      scheduleId: row.id,
      organizationId: row.organizationId,
      customerId: row.asset.customerId,
      customerPhone: phone,
      assetName: row.asset.displayName,
      scheduleName: row.name,
      dueState,
    });
  }
  return targets;
}

/** Sends one PM reminder text and stamps lastRemindedAt (idempotent per 30 days). */
export async function sendPmReminder(
  db: PrismaClient,
  target: DueSweepTarget,
  organizationName: string,
): Promise<boolean> {
  const systemContext = {
    actorId: target.customerId,
    organizationId: target.organizationId,
    membershipId: "00000000-0000-4000-8000-000000000000",
    requestId: `pm:${target.scheduleId}`,
    organizationWideLocationAccess: true,
    allowedLocationIds: new Set<string>(),
    permissions: new Set(["customers.write"] as const),
  } as import("@/modules/tenancy/policy").TenantContext;

  try {
    await sendCustomerSms({
      db,
      context: systemContext,
      customerId: target.customerId,
      to: target.customerPhone!,
      body: `Hi from ${organizationName} — your ${target.assetName} is due for ${target.scheduleName}${
        target.dueState === "due" ? "" : " soon"
      }. Reply to book a time that works.`,
    });
    await db.maintenanceSchedule.update({
      where: { id: target.scheduleId },
      data: { lastRemindedAt: new Date() },
    });
    return true;
  } catch {
    return false;
  }
}

/** Updates the asset's known odometer (from intake or a service visit). */
export async function recordAssetMileage(
  input: PmServiceInput & { assetId: string; mileage: number },
): Promise<void> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "assets.write",
  );

  if (!Number.isSafeInteger(input.mileage) || input.mileage < 0) {
    throw new PmFailed("invalid_interval");
  }
  await input.db.automotiveAssetProfile.upsert({
    where: { assetId: input.assetId },
    update: { lastKnownMileage: input.mileage },
    create: { assetId: input.assetId, lastKnownMileage: input.mileage },
  });
}
