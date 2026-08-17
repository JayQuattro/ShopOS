import { z } from "zod";

import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";
import {
  AppointmentFailed,
  createAppointment,
  listAppointmentsInRange,
} from "@/modules/appointments/appointment-service";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  locationId: z.string().uuid(),
  customerId: z.string().uuid(),
  assetId: z.string().uuid().optional(),
  reason: z.string().trim().min(3).max(500),
  notes: z.string().trim().max(2000).optional(),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
});

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const tenantContext = await getRequestContext();
    const result = await createAppointment({
      db,
      context: tenantContext,
      locationId: parsed.data.locationId,
      customerId: parsed.data.customerId,
      ...(parsed.data.assetId ? { assetId: parsed.data.assetId } : {}),
      reason: parsed.data.reason,
      ...(parsed.data.notes ? { notes: parsed.data.notes } : {}),
      startAt: new Date(parsed.data.startAt),
      endAt: new Date(parsed.data.endAt),
    });
    return Response.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AppointmentFailed) {
      return Response.json({ error: error.reason }, { status: 400 });
    }
    return mapTenantError(error);
  }
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!from || !to) {
    return Response.json({ error: "missing_range" }, { status: 400 });
  }
  const fromDate = new Date(from);
  const toDate = new Date(to);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    return Response.json({ error: "invalid_range" }, { status: 400 });
  }

  try {
    const tenantContext = await getRequestContext();
    const appointments = await listAppointmentsInRange({
      db,
      context: tenantContext,
      from: fromDate,
      to: toDate,
    });
    return Response.json(
      {
        appointments: appointments.map((appointment) => ({
          ...appointment,
          startAt: appointment.startAt.toISOString(),
          endAt: appointment.endAt.toISOString(),
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return mapTenantError(error);
  }
}
