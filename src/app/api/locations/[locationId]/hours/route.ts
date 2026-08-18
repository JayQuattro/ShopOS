import { z } from "zod";

import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";
import {
  BusinessHoursFailed,
  getBusinessHours,
  replaceBusinessHours,
  updateBookingSettings,
} from "@/modules/organizations/business-hours-service";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ locationId: string }> },
): Promise<Response> {
  try {
    const tenantContext = await getRequestContext();
    const { locationId } = await context.params;
    const config = await getBusinessHours(db, tenantContext, locationId);
    return Response.json(config, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return hoursError(error);
  }
}

const windowSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  openMinute: z.number().int().min(0).max(1439),
  closeMinute: z.number().int().min(1).max(1440),
});

const putSchema = z.object({
  hours: z.array(windowSchema),
  slotMinutes: z.number().int().min(15).max(480),
  bookingCapacity: z.number().int().min(1).max(50),
});

export async function PUT(
  request: Request,
  context: { params: Promise<{ locationId: string }> },
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const tenantContext = await getRequestContext();
    const { locationId } = await context.params;
    await replaceBusinessHours(db, tenantContext, locationId, parsed.data.hours);
    await updateBookingSettings(db, tenantContext, locationId, {
      slotMinutes: parsed.data.slotMinutes,
      bookingCapacity: parsed.data.bookingCapacity,
    });
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return hoursError(error);
  }
}

function hoursError(error: unknown): Response {
  if (error instanceof BusinessHoursFailed) {
    const statusMap: Record<string, number> = { location_not_found: 404 };
    return Response.json({ error: error.reason }, { status: statusMap[error.reason] ?? 400 });
  }
  return mapTenantError(error);
}
