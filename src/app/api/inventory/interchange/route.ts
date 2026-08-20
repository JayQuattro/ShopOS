import { z } from "zod";

import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { findInterchange } from "@/modules/inventory/inventory-service";

export const dynamic = "force-dynamic";

const querySchema = z.object({ oeNumber: z.string().trim().min(1).max(120) });

/** Parts that interchange on the same OE number, across manufacturers. */
export async function GET(request: Request): Promise<Response> {
  const parsed = querySchema.safeParse({
    oeNumber: new URL(request.url).searchParams.get("oeNumber") ?? undefined,
  });
  if (!parsed.success) {
    return Response.json({ error: "invalid_query" }, { status: 400 });
  }

  try {
    const tenantContext = await getRequestContext();
    const matches = await findInterchange({
      db,
      context: tenantContext,
      oeNumber: parsed.data.oeNumber,
    });
    return Response.json({ matches }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapTenantError(error);
  }
}
