import { z } from "zod";

import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { setInvoiceWarranty, WarrantyFailed } from "@/modules/invoices/warranty-service";

export const dynamic = "force-dynamic";

const schema = z.object({
  warrantyMonths: z.number().int().min(1).nullable().optional(),
  warrantyMiles: z.number().int().min(1).nullable().optional(),
});

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }
  const { id } = await context.params;
  try {
    const tenantContext = await getRequestContext();
    const result = await setInvoiceWarranty({
      db,
      context: tenantContext,
      invoiceId: id,
      ...(parsed.data.warrantyMonths !== undefined
        ? { warrantyMonths: parsed.data.warrantyMonths }
        : {}),
      ...(parsed.data.warrantyMiles !== undefined
        ? { warrantyMiles: parsed.data.warrantyMiles }
        : {}),
    });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof WarrantyFailed) {
      const statusMap: Record<string, number> = {
        invoice_not_found: 404,
        invoice_not_draft: 409,
        invalid_terms: 400,
      };
      return Response.json({ error: error.reason }, { status: statusMap[error.reason] ?? 400 });
    }
    return mapTenantError(error);
  }
}
