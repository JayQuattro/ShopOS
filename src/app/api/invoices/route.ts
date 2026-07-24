import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { createInvoiceFromWorkOrder, InvoiceFailed } from "@/modules/invoices/invoice-service";
import { z } from "zod";

export const dynamic = "force-dynamic";

const createSchema = z.object({ workOrderId: z.string().uuid() });

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
    const context = await getRequestContext();
    const result = await createInvoiceFromWorkOrder({
      db,
      context,
      workOrderId: parsed.data.workOrderId,
    });
    return Response.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof InvoiceFailed) {
      const status = error.reason === "work_order_not_found" ? 404 : 409;
      return Response.json({ error: error.reason }, { status });
    }
    return mapTenantError(error);
  }
}
