import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { EstimateFailed, supersedeRevision } from "@/modules/estimates/estimate-service";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: { params: Promise<{ revisionId: string }> },
): Promise<Response> {
  try {
    const tenantContext = await getRequestContext();
    const { revisionId } = await context.params;
    const result = await supersedeRevision({ db, context: tenantContext, revisionId });
    return Response.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof EstimateFailed) {
      return Response.json({ error: error.reason }, { status: 400 });
    }
    return mapTenantError(error);
  }
}
