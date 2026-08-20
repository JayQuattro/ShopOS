import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { listWaitingByVendor } from "@/modules/parts/part-order-service";

export const dynamic = "force-dynamic";

/** All open orders grouped by vendor — the "what are we waiting for" board. */
export async function GET(): Promise<Response> {
  try {
    const tenantContext = await getRequestContext();
    const groups = await listWaitingByVendor({ db, context: tenantContext });
    return Response.json(
      {
        groups: groups.map((group) => ({
          ...group,
          orders: group.orders.map((order) => ({
            ...order,
            orderedAt: order.orderedAt?.toISOString() ?? null,
          })),
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return mapTenantError(error);
  }
}
