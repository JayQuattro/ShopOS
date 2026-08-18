import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import { assertTenantAccess, type TenantContext } from "@/modules/tenancy/policy";

export type NotificationSettings = Readonly<{
  notifyEstimateEmail: boolean;
  notifyDecisionReceiptEmail: boolean;
  notifyInvoiceEmail: boolean;
  notifyPaymentReceiptEmail: boolean;
  notifyAppointmentReminders: boolean;
  notifyPmReminders: boolean;
  notifyReviewRequests: boolean;
  appointmentReminderLeadHours: number;
  noShowCutoffHours: number;
  pmReminderCooldownDays: number;
}>;

export class NotificationSettingsFailed extends Error {
  constructor(
    public readonly reason:
      | "organization_not_found"
      | "invalid_lead_hours"
      | "invalid_no_show_cutoff"
      | "invalid_pm_cooldown",
  ) {
    super("The notification settings operation could not be completed.");
    this.name = "NotificationSettingsFailed";
  }
}

/** Reads the org's notification toggles and communication cadence. */
export async function getNotificationSettings(
  db: PrismaClient,
  context: TenantContext,
): Promise<NotificationSettings> {
  assertTenantAccess(context, { organizationId: context.organizationId }, "organizations.manage");

  const organization = await db.organization.findUnique({
    where: { id: context.organizationId },
    select: {
      notifyEstimateEmail: true,
      notifyDecisionReceiptEmail: true,
      notifyInvoiceEmail: true,
      notifyPaymentReceiptEmail: true,
      notifyAppointmentReminders: true,
      notifyPmReminders: true,
      notifyReviewRequests: true,
      appointmentReminderLeadHours: true,
      noShowCutoffHours: true,
      pmReminderCooldownDays: true,
    },
  });
  if (!organization) throw new NotificationSettingsFailed("organization_not_found");
  return organization;
}

const BOUNDS = {
  appointmentReminderLeadHours: [1, 168],
  noShowCutoffHours: [1, 48],
  pmReminderCooldownDays: [1, 365],
} as const;

/** Updates toggles and cadence; bounds mirror the DB check constraints. */
export async function updateNotificationSettings(
  db: PrismaClient,
  context: TenantContext,
  settings: NotificationSettings,
): Promise<void> {
  assertTenantAccess(context, { organizationId: context.organizationId }, "organizations.manage");

  for (const [field, [min, max]] of Object.entries(BOUNDS) as [
    keyof typeof BOUNDS,
    readonly [number, number],
  ][]) {
    const value = settings[field];
    if (!Number.isSafeInteger(value) || value < min || value > max) {
      const reason =
        field === "appointmentReminderLeadHours"
          ? "invalid_lead_hours"
          : field === "noShowCutoffHours"
            ? "invalid_no_show_cutoff"
            : "invalid_pm_cooldown";
      throw new NotificationSettingsFailed(reason);
    }
  }

  await db.$transaction(async (transaction) => {
    const before = await transaction.organization.findUnique({
      where: { id: context.organizationId },
      select: { ...BOUNDS_SELECTOR, ...TOGGLES_SELECTOR },
    });
    if (!before) throw new NotificationSettingsFailed("organization_not_found");

    await transaction.organization.update({
      where: { id: context.organizationId },
      data: settings,
    });

    await transaction.auditEvent.create({
      data: {
        id: randomUUID(),
        organizationId: context.organizationId,
        actorUserId: context.actorId,
        action: "organization.notification_settings_updated",
        entityType: "organization",
        entityId: context.organizationId,
        requestId: context.requestId,
        before: { ...before },
        after: { ...settings },
      },
    });
  });
}

const TOGGLES_SELECTOR = {
  notifyEstimateEmail: true,
  notifyDecisionReceiptEmail: true,
  notifyInvoiceEmail: true,
  notifyPaymentReceiptEmail: true,
  notifyAppointmentReminders: true,
  notifyPmReminders: true,
  notifyReviewRequests: true,
} as const;

const BOUNDS_SELECTOR = {
  appointmentReminderLeadHours: true,
  noShowCutoffHours: true,
  pmReminderCooldownDays: true,
} as const;
