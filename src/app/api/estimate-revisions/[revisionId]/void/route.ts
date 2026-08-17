import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { ChangeOrderFailed, voidChangeOrder } from "@/modules/estimates/change-order-service";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: { params: Promise<{ revisionId: string }> },
): Promise<Response> {
  try {
    const tenantContext = await getRequestContext();
    const { revisionId } = await context.params;
    await voidChangeOrder({
      db,
      context: tenantContext,
      revisionId,
    });
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ChangeOrderFailed) {
      return Response.json({ error: error.reason }, { status: 400 });
    }
    return mapTenantError(error);
  }
}
