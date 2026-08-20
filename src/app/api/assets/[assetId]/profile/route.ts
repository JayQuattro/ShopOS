import { z } from "zod";

import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  vin: z.string().trim().max(32).optional(),
  licensePlate: z.string().trim().max(32).optional(),
  plateJurisdiction: z.string().trim().max(32).optional(),
  lastKnownMileage: z.number().int().min(0).optional(),
});

/** Upserts automotive identity (VIN/plate) and mileage on an asset. */
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

    if (!tenantContext.permissions.has("assets.write")) {
      return Response.json({ error: "permission_denied" }, { status: 403 });
    }

    const asset = await db.asset.findFirst({
      where: { id: assetId, organizationId: tenantContext.organizationId },
      select: { id: true },
    });
    if (!asset) return Response.json({ error: "not_found" }, { status: 404 });

    await db.automotiveAssetProfile.upsert({
      where: { assetId: asset.id },
      update: {
        ...(parsed.data.vin !== undefined ? { vin: parsed.data.vin || null } : {}),
        ...(parsed.data.licensePlate !== undefined
          ? { licensePlate: parsed.data.licensePlate || null }
          : {}),
        ...(parsed.data.plateJurisdiction !== undefined
          ? { plateJurisdiction: parsed.data.plateJurisdiction || null }
          : {}),
        ...(parsed.data.lastKnownMileage !== undefined
          ? { lastKnownMileage: parsed.data.lastKnownMileage }
          : {}),
      },
      create: {
        assetId: asset.id,
        ...(parsed.data.vin ? { vin: parsed.data.vin } : {}),
        ...(parsed.data.licensePlate ? { licensePlate: parsed.data.licensePlate } : {}),
        ...(parsed.data.plateJurisdiction
          ? { plateJurisdiction: parsed.data.plateJurisdiction }
          : {}),
        ...(parsed.data.lastKnownMileage !== undefined
          ? { lastKnownMileage: parsed.data.lastKnownMileage }
          : {}),
      },
    });
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapTenantError(error);
  }
}
