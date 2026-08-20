import { z } from "zod";

import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  registrationExpiresAt: z.string().datetime().nullable().optional(),
  insuranceExpiresAt: z.string().datetime().nullable().optional(),
});

/** Sets registration/insurance expiry dates on a shop fleet vehicle. */
export async function PUT(
  request: Request,
  context: { params: Promise<{ assetId: string }> },
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
    const { assetId } = await context.params;

    const updated = await db.asset.updateMany({
      where: {
        id: assetId,
        organizationId: tenantContext.organizationId,
        isFleetVehicle: true,
      },
      data: {
        ...(parsed.data.registrationExpiresAt !== undefined
          ? {
              registrationExpiresAt: parsed.data.registrationExpiresAt
                ? new Date(parsed.data.registrationExpiresAt)
                : null,
            }
          : {}),
        ...(parsed.data.insuranceExpiresAt !== undefined
          ? {
              insuranceExpiresAt: parsed.data.insuranceExpiresAt
                ? new Date(parsed.data.insuranceExpiresAt)
                : null,
            }
          : {}),
      },
    });
    if (updated.count !== 1) {
      return Response.json({ error: "asset_not_found" }, { status: 404 });
    }
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapTenantError(error);
  }
}
