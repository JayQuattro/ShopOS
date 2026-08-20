import { z } from "zod";

import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { EstimateFailed, reorderLines } from "@/modules/estimates/estimate-service";

export const dynamic = "force-dynamic";

const orderSchema = z.object({
  items: z
    .array(
      z.object({
        lineId: z.string().uuid(),
        serviceGroupKey: z.string().trim().min(1).max(80),
      }),
    )
    .min(1),
});

/** Reorders draft lines and moves them between job groups (drag & drop save). */
export async function PUT(
  request: Request,
  context: { params: Promise<{ revisionId: string }> },
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  const parsed = orderSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const tenantContext = await getRequestContext();
    const { revisionId } = await context.params;
    await reorderLines({
      db,
      context: tenantContext,
      revisionId,
      items: parsed.data.items,
    });
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof EstimateFailed) {
      return Response.json({ error: error.reason }, { status: 400 });
    }
    return mapTenantError(error);
  }
}
