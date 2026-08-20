import { z } from "zod";

import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";
import {
  cancelLoanerReservation,
  listLoanerReservations,
  LoanerReservationFailed,
  reserveLoaner,
} from "@/modules/loaners/loaner-reservation-service";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ organizationId: string }> },
): Promise<Response> {
  try {
    const { organizationId } = await context.params;
    const tenantContext = await getRequestContext(organizationId);
    const fromParam = new URL(request.url).searchParams.get("from");
    const reservations = await listLoanerReservations({
      db,
      context: tenantContext,
      ...(fromParam ? { from: new Date(fromParam) } : {}),
    });
    return Response.json(
      {
        reservations: reservations.map((reservation) => ({
          ...reservation,
          reservedFrom: reservation.reservedFrom.toISOString(),
          reservedTo: reservation.reservedTo.toISOString(),
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return reservationError(error);
  }
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("reserve"),
    assetId: z.string().uuid(),
    customerId: z.string().uuid(),
    locationId: z.string().uuid(),
    workOrderId: z.string().uuid().optional(),
    reservedFrom: z.string().datetime(),
    reservedTo: z.string().datetime(),
    note: z.string().trim().max(500).optional(),
  }),
  z.object({ action: z.literal("cancel"), reservationId: z.string().uuid() }),
]);

export async function POST(
  request: Request,
  context: { params: Promise<{ organizationId: string }> },
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
    const { organizationId } = await context.params;
    const tenantContext = await getRequestContext(organizationId);

    if (parsed.data.action === "reserve") {
      const result = await reserveLoaner({
        db,
        context: tenantContext,
        assetId: parsed.data.assetId,
        customerId: parsed.data.customerId,
        locationId: parsed.data.locationId,
        ...(parsed.data.workOrderId ? { workOrderId: parsed.data.workOrderId } : {}),
        reservedFrom: new Date(parsed.data.reservedFrom),
        reservedTo: new Date(parsed.data.reservedTo),
        ...(parsed.data.note ? { note: parsed.data.note } : {}),
      });
      return Response.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
    }

    await cancelLoanerReservation({
      db,
      context: tenantContext,
      reservationId: parsed.data.reservationId,
    });
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return reservationError(error);
  }
}

function reservationError(error: unknown): Response {
  if (error instanceof LoanerReservationFailed) {
    const statusMap: Record<string, number> = {
      asset_not_found: 404,
      customer_not_found: 404,
      work_order_not_found: 404,
      reservation_not_found: 404,
      asset_not_fleet: 400,
      invalid_window: 400,
      asset_already_out: 409,
      asset_already_reserved: 409,
      not_reserved: 409,
    };
    return Response.json({ error: error.reason }, { status: statusMap[error.reason] ?? 400 });
  }
  return mapTenantError(error);
}
