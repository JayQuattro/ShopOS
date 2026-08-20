import { z } from "zod";

import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";
import {
  checkInLoaner,
  checkOutLoaner,
  listLoanersForWorkOrder,
  LoanerFailed,
} from "@/modules/loaners/loaner-service";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const tenantContext = await getRequestContext();
    const { id } = await context.params;
    const checkouts = await listLoanersForWorkOrder({
      db,
      context: tenantContext,
      workOrderId: id,
    });
    return Response.json(
      {
        checkouts: checkouts.map((checkout) => ({
          ...checkout,
          checkedOutAt: checkout.checkedOutAt.toISOString(),
          checkedInAt: checkout.checkedInAt?.toISOString() ?? null,
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return loanerError(error);
  }
}

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("check-out"),
    assetId: z.string().uuid(),
    outMileage: z.number().int().min(0).optional(),
    fuelOut: z.number().int().min(0).max(100).optional(),
    conditionNote: z.string().trim().max(1000).optional(),
    acknowledgedBy: z.string().trim().min(2).max(180).optional(),
    note: z.string().trim().max(1000).optional(),
  }),
  z.object({
    action: z.literal("check-in"),
    checkoutId: z.string().uuid(),
    inMileage: z.number().int().min(0).optional(),
  }),
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

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const tenantContext = await getRequestContext();
    const { id } = await context.params;
    if (parsed.data.action === "check-out") {
      const result = await checkOutLoaner({
        db,
        context: tenantContext,
        workOrderId: id,
        assetId: parsed.data.assetId,
        ...(parsed.data.outMileage !== undefined ? { outMileage: parsed.data.outMileage } : {}),
        ...(parsed.data.fuelOut !== undefined ? { fuelOut: parsed.data.fuelOut } : {}),
        ...(parsed.data.conditionNote ? { conditionNote: parsed.data.conditionNote } : {}),
        ...(parsed.data.acknowledgedBy ? { acknowledgedBy: parsed.data.acknowledgedBy } : {}),
        ...(parsed.data.note ? { note: parsed.data.note } : {}),
      });
      return Response.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
    }
    await checkInLoaner({
      db,
      context: tenantContext,
      checkoutId: parsed.data.checkoutId,
      ...(parsed.data.inMileage !== undefined ? { inMileage: parsed.data.inMileage } : {}),
    });
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return loanerError(error);
  }
}

function loanerError(error: unknown): Response {
  if (error instanceof LoanerFailed) {
    const statusMap: Record<string, number> = {
      work_order_not_found: 404,
      asset_not_found: 404,
      checkout_not_found: 404,
      asset_already_out: 409,
      work_order_already_has_loaner: 409,
      already_checked_in: 409,
    };
    return Response.json({ error: error.reason }, { status: statusMap[error.reason] ?? 400 });
  }
  return mapTenantError(error);
}
