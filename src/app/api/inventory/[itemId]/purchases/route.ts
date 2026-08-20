import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { listPurchaseHistory } from "@/modules/parts/part-order-service";

export const dynamic = "force-dynamic";

/** Purchase history for one stocked item: last bought X from Y, with purpose. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ itemId: string }> },
): Promise<Response> {
  try {
    const tenantContext = await getRequestContext();
    const { itemId } = await context.params;
    const purchases = await listPurchaseHistory({
      db,
      context: tenantContext,
      inventoryItemId: itemId,
    });
    return Response.json(
      {
        purchases: purchases.map((purchase) => ({
          ...purchase,
          orderedAt: purchase.orderedAt?.toISOString() ?? null,
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return mapTenantError(error);
  }
}
