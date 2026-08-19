import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";
import {
  EInvoiceFailed,
  generateEInvoice,
  getEInvoiceDocument,
} from "@/modules/integrations/einvoicing/einvoice-service";

export const dynamic = "force-dynamic";

/** Generates the standard XML for an issued invoice, then returns it. */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const tenantContext = await getRequestContext();
    const { id } = await context.params;
    await generateEInvoice({ db, context: tenantContext, invoiceId: id });
    return await GET(_request, context);
  } catch (error) {
    return einvoiceError(error);
  }
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const tenantContext = await getRequestContext();
    const { id } = await context.params;
    const document = await getEInvoiceDocument({ db, context: tenantContext, invoiceId: id });
    return new Response(document.xml, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Content-Disposition": `attachment; filename="${document.filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return einvoiceError(error);
  }
}

function einvoiceError(error: unknown): Response {
  if (error instanceof EInvoiceFailed) {
    const statusMap: Record<string, number> = {
      invoice_not_found: 404,
      invoice_not_issued: 409,
      no_format_configured: 409,
      unsupported_format: 400,
    };
    return Response.json({ error: error.reason }, { status: statusMap[error.reason] ?? 400 });
  }
  return mapTenantError(error);
}
