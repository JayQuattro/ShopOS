import { z } from "zod";

import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";
import {
  AppointmentFailed,
  convertAppointmentToWorkOrder,
  rescheduleAppointment,
  transitionAppointment,
  type AppointmentStatusValue,
} from "@/modules/appointments/appointment-service";

export const dynamic = "force-dynamic";

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("transition"),
    targetStatus: z.enum([
      "CONFIRMED",
      "CHECKED_IN",
      "COMPLETED",
      "CANCELLED",
      "NO_SHOW",
    ] satisfies [AppointmentStatusValue, ...AppointmentStatusValue[]]),
  }),
  z.object({
    action: z.literal("reschedule"),
    startAt: z.string().datetime(),
    endAt: z.string().datetime(),
  }),
  z.object({ action: z.literal("convert") }),
]);

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const tenantContext = await getRequestContext();
    const { id } = await context.params;

    if (parsed.data.action === "transition") {
      await transitionAppointment({
        db,
        context: tenantContext,
        appointmentId: id,
        targetStatus: parsed.data.targetStatus,
      });
      return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    }

    if (parsed.data.action === "reschedule") {
      await rescheduleAppointment({
        db,
        context: tenantContext,
        appointmentId: id,
        startAt: new Date(parsed.data.startAt),
        endAt: new Date(parsed.data.endAt),
      });
      return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    }

    const result = await convertAppointmentToWorkOrder({
      db,
      context: tenantContext,
      appointmentId: id,
    });
    return Response.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AppointmentFailed) {
      return Response.json({ error: error.reason }, { status: 400 });
    }
    return mapTenantError(error);
  }
}
