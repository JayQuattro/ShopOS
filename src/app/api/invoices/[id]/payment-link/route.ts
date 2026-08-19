import { z } from "zod";

import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";
import {
  createInvoicePaymentLink,
  PaymentLinkFailed,
} from "@/modules/billing/payment-link-service";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  returnUrl: z.string().url().max(2048),
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
    const result = await createInvoicePaymentLink({
      db,
      context: tenantContext,
      invoiceId: id,
      returnUrl: parsed.data.returnUrl,
    });
    return Response.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof PaymentLinkFailed) {
      const statusMap: Record<string, number> = {
        invoice_not_found: 404,
        invoice_not_issued: 409,
        invoice_already_paid: 409,
        no_processor: 409,
        provider_error: 502,
      };
      return Response.json({ error: error.reason }, { status: statusMap[error.reason] ?? 400 });
    }
    return mapTenantError(error);
  }
}
