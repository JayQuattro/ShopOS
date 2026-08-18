import { z } from "zod";

import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { FleetFailed, setFleetVehicle } from "@/modules/assets/fleet-service";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ isFleetVehicle: z.boolean() });

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
    await setFleetVehicle({
      db,
      context: tenantContext,
      assetId,
      isFleetVehicle: parsed.data.isFleetVehicle,
    });
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof FleetFailed) {
      return Response.json({ error: error.reason }, { status: 404 });
    }
    return mapTenantError(error);
  }
}
