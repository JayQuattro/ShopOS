import { z } from "zod";

import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";
import {
  collectedForServiceCall,
  FieldPaymentFailed,
  recordFieldPayment,
} from "@/modules/service-calls/field-payment-service";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ organizationId: string; serviceCallId: string }> },
): Promise<Response> {
  try {
    const { organizationId, serviceCallId } = await context.params;
    const tenantContext = await getRequestContext(organizationId);
    const collected = await collectedForServiceCall({
      db,
      context: tenantContext,
      serviceCallId,
    });
    return Response.json(
      { totalMinor: collected.totalMinor.toString(), currency: collected.currency },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return fieldPaymentError(error);
  }
}

const bodySchema = z.object({
  amountMinor: z.number().int().positive(),
  method: z.enum(["CASH", "CARD_EXTERNAL", "CHECK", "BANK_TRANSFER", "OTHER"]),
  reference: z.string().trim().max(160).optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ organizationId: string; serviceCallId: string }> },
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
    const { organizationId, serviceCallId } = await context.params;
    const tenantContext = await getRequestContext(organizationId);
    const result = await recordFieldPayment({
      db,
      context: tenantContext,
      serviceCallId,
      amountMinor: parsed.data.amountMinor,
      method: parsed.data.method,
      ...(parsed.data.reference ? { reference: parsed.data.reference } : {}),
    });
    return Response.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fieldPaymentError(error);
  }
}

function fieldPaymentError(error: unknown): Response {
  if (error instanceof FieldPaymentFailed) {
    const statusMap: Record<string, number> = {
      service_call_not_found: 404,
      invalid_amount: 400,
    };
    return Response.json({ error: error.reason }, { status: statusMap[error.reason] ?? 400 });
  }
  return mapTenantError(error);
}
