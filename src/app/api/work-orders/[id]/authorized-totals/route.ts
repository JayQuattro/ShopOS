import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { getAuthorizedTotals } from "@/modules/estimates/change-order-service";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const tenantContext = await getRequestContext();
    const { id } = await context.params;
    const totals = await getAuthorizedTotals(db, {
      organizationId: tenantContext.organizationId,
      workOrderId: id,
    });
    if (!totals) {
      return Response.json({ error: "baseline_not_presented" }, { status: 404 });
    }
    return Response.json(totals, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapTenantError(error);
  }
}
