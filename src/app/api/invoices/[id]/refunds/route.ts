import { z } from "zod";

import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";
import {
  listRefundablePayments,
  RefundFailed,
  refundPayment,
} from "@/modules/billing/refund-service";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const tenantContext = await getRequestContext();
    const { id } = await context.params;
    const payments = await listRefundablePayments({ db, context: tenantContext, invoiceId: id });
    return Response.json(
      {
        payments: payments.map((payment) => ({
          ...payment,
          amountMinor: payment.amountMinor.toString(),
          refundableMinor: payment.refundableMinor.toString(),
          receivedAt: payment.receivedAt.toISOString(),
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return mapTenantError(error);
  }
}

const bodySchema = z.object({
  paymentId: z.string().uuid(),
  amountMinor: z.number().int().positive().optional(),
  reason: z.string().trim().max(500).optional(),
});

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
    const result = await refundPayment({
      db,
      context: tenantContext,
      paymentId: parsed.data.paymentId,
      ...(parsed.data.amountMinor !== undefined ? { amountMinor: parsed.data.amountMinor } : {}),
      ...(parsed.data.reason ? { reason: parsed.data.reason } : {}),
    });
    void id; // the payment defines the invoice; the path id is informational
    return Response.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof RefundFailed) {
      const statusMap: Record<string, number> = {
        payment_not_found: 404,
        refund_exceeds_payment: 409,
        invalid_amount: 400,
        processor_refund_failed: 502,
        processor_unavailable: 409,
      };
      return Response.json({ error: error.reason }, { status: statusMap[error.reason] ?? 400 });
    }
    return mapTenantError(error);
  }
}
