import { z } from "zod";

import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";
import {
  deleteHoliday,
  HolidayFailed,
  listHolidays,
  upsertHoliday,
} from "@/modules/organizations/holiday-service";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ organizationId: string; locationId: string }> },
): Promise<Response> {
  try {
    const { organizationId, locationId } = await context.params;
    const tenantContext = await getRequestContext(organizationId);
    const params = new URL(request.url).searchParams;
    const from = params.get("from");
    const to = params.get("to");
    if (!from || !to) {
      return Response.json({ error: "invalid_query" }, { status: 400 });
    }
    const holidays = await listHolidays({
      db,
      context: tenantContext,
      locationId,
      from,
      to,
    });
    return Response.json({ holidays }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return holidayError(error);
  }
}

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("upsert"),
    date: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/),
    name: z.string().trim().min(2).max(120),
    closesAllDay: z.boolean().optional(),
  }),
  z.object({ action: z.literal("delete"), holidayId: z.string().uuid() }),
]);

export async function POST(
  request: Request,
  context: { params: Promise<{ organizationId: string; locationId: string }> },
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const { organizationId, locationId } = await context.params;
    const tenantContext = await getRequestContext(organizationId);

    if (parsed.data.action === "upsert") {
      const result = await upsertHoliday({
        db,
        context: tenantContext,
        locationId,
        date: parsed.data.date,
        name: parsed.data.name,
        ...(parsed.data.closesAllDay !== undefined
          ? { closesAllDay: parsed.data.closesAllDay }
          : {}),
      });
      return Response.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
    }

    await deleteHoliday({ db, context: tenantContext, holidayId: parsed.data.holidayId });
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return holidayError(error);
  }
}

function holidayError(error: unknown): Response {
  if (error instanceof HolidayFailed) {
    const statusMap: Record<string, number> = {
      not_found: 404,
      location_not_found: 404,
      invalid_date: 400,
      invalid_name: 400,
    };
    return Response.json({ error: error.reason }, { status: statusMap[error.reason] ?? 400 });
  }
  return mapTenantError(error);
}
