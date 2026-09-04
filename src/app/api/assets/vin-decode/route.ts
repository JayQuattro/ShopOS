import { z } from "zod";

import { db } from "@/db/client";
import { hasTrustedMutationOrigin } from "@/modules/identity/request-origin";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { validateVin } from "@/modules/assets/vin";
import { resolveVehicleIdAdapter } from "@/modules/integrations/vehicle-id/vehicle-id-connector-service";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ vin: z.string().min(1).max(32) });

/**
 * Decodes a VIN through the active vehicle-identification adapter so the
 * add-vehicle form can pre-fill year/make/model and engine details. Purely
 * additive: a failure never blocks manual entry.
 */
export async function POST(request: Request): Promise<Response> {
  if (!hasTrustedMutationOrigin(request)) {
    return Response.json({ error: "untrusted_origin" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  const validation = validateVin(parsed.data.vin);
  if (!validation.valid) {
    return Response.json({ error: "invalid_vin", reason: validation.reason }, { status: 422 });
  }

  try {
    const tenantContext = await getRequestContext();

    if (!tenantContext.permissions.has("assets.write")) {
      return Response.json({ error: "permission_denied" }, { status: 403 });
    }

    const adapter = await resolveVehicleIdAdapter(db, tenantContext.organizationId);
    if (!adapter) {
      return Response.json({ error: "decode_unavailable" }, { status: 503 });
    }

    const vehicle = await adapter.decodeVin(validation.vin);
    if (!vehicle) {
      return Response.json({ error: "no_match" }, { status: 422 });
    }

    return Response.json(
      { vin: validation.vin, vehicle },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return mapTenantError(error);
  }
}
