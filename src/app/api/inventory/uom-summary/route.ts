import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { uomSummary } from "@/modules/inventory/inventory-service";

export const dynamic = "force-dynamic";

/** Base-unit totals per UoM group (total quarts across containers). */
export async function GET(): Promise<Response> {
  try {
    const tenantContext = await getRequestContext();
    const summary = await uomSummary({ db, context: tenantContext });
    return Response.json({ groups: summary }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapTenantError(error);
  }
}
