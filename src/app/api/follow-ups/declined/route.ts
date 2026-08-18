import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { listDeclinedWork } from "@/modules/followups/declined-work-service";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const tenantContext = await getRequestContext();
    const items = await listDeclinedWork({ db, context: tenantContext });
    return Response.json(
      {
        items: items.map((item) => ({
          ...item,
          declinedAt: item.declinedAt.toISOString(),
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return mapTenantError(error);
  }
}
