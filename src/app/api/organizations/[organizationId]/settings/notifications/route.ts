import { z } from "zod";

import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";
import {
  getNotificationSettings,
  NotificationSettingsFailed,
  updateNotificationSettings,
} from "@/modules/organizations/notification-settings-service";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ organizationId: string }> },
): Promise<Response> {
  try {
    const { organizationId } = await context.params;
    const tenantContext = await getRequestContext(organizationId);
    if (tenantContext.organizationId !== organizationId) {
      return Response.json({ error: "organization_denied" }, { status: 403 });
    }
    const settings = await getNotificationSettings(db, tenantContext);
    return Response.json(settings, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return notifyError(error);
  }
}

const updateSchema = z.object({
  notifyEstimateEmail: z.boolean(),
  notifyDecisionReceiptEmail: z.boolean(),
  notifyInvoiceEmail: z.boolean(),
  notifyPaymentReceiptEmail: z.boolean(),
  notifyAppointmentReminders: z.boolean(),
  notifyPmReminders: z.boolean(),
  notifyReviewRequests: z.boolean(),
  appointmentReminderLeadHours: z.number().int().min(1).max(168),
  noShowCutoffHours: z.number().int().min(1).max(48),
  pmReminderCooldownDays: z.number().int().min(1).max(365),
});

export async function PUT(
  request: Request,
  context: { params: Promise<{ organizationId: string }> },
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const { organizationId } = await context.params;
    const tenantContext = await getRequestContext(organizationId);
    if (tenantContext.organizationId !== organizationId) {
      return Response.json({ error: "organization_denied" }, { status: 403 });
    }
    await updateNotificationSettings(db, tenantContext, parsed.data);
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return notifyError(error);
  }
}

function notifyError(error: unknown): Response {
  if (error instanceof NotificationSettingsFailed) {
    return Response.json({ error: error.reason }, { status: 400 });
  }
  return mapTenantError(error);
}
