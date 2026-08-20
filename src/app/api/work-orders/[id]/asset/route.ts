import { z } from "zod";

import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ assetId: z.string().uuid().nullable() });

/** Assigns (or clears) the customer's asset on a work order. */
export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const tenantContext = await getRequestContext();
    const { id } = await context.params;
    if (!tenantContext.permissions.has("work_orders.write")) {
      return Response.json({ error: "permission_denied" }, { status: 403 });
    }

    await db.$transaction(async (transaction) => {
      const workOrder = await transaction.workOrder.findFirst({
        where: { id, organizationId: tenantContext.organizationId },
        select: { id: true, customerId: true },
      });
      if (!workOrder) throw new AssetAssignFailed("work_order_not_found");

      if (parsed.data.assetId) {
        // The asset must belong to this work order's customer in this org —
        // never another customer's vehicle.
        const asset = await transaction.asset.findFirst({
          where: {
            id: parsed.data.assetId,
            organizationId: tenantContext.organizationId,
            customerId: workOrder.customerId,
          },
          select: { id: true },
        });
        if (!asset) throw new AssetAssignFailed("asset_not_for_customer");
      }

      await transaction.workOrder.update({
        where: { id: workOrder.id },
        data: { assetId: parsed.data.assetId },
      });
    });

    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AssetAssignFailed) {
      return Response.json({ error: error.reason }, { status: 404 });
    }
    return mapTenantError(error);
  }
}

class AssetAssignFailed extends Error {
  constructor(public readonly reason: "work_order_not_found" | "asset_not_for_customer") {
    super("The asset could not be assigned.");
    this.name = "AssetAssignFailed";
  }
}
