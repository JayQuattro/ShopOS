import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { InvoiceFailed, issueInvoice } from "@/modules/invoices/invoice-service";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const tenantContext = await getRequestContext();
    const { id } = await context.params;
    await issueInvoice({ db, context: tenantContext, invoiceId: id });
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof InvoiceFailed) {
      const status = error.reason === "invoice_not_found" ? 404 : 409;
      return Response.json({ error: error.reason }, { status });
    }
    return mapTenantError(error);
  }
}
