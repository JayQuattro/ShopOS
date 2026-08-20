import { z } from "zod";

import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { EstimateFailed, renameServiceGroup } from "@/modules/estimates/estimate-service";

export const dynamic = "force-dynamic";

const renameSchema = z.object({
  key: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(160),
});

/** Renames a job group on a draft revision (key and label move together). */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ revisionId: string }> },
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  const parsed = renameSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const tenantContext = await getRequestContext();
    const { revisionId } = await context.params;
    const result = await renameServiceGroup({
      db,
      context: tenantContext,
      revisionId,
      key: parsed.data.key,
      label: parsed.data.label,
    });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof EstimateFailed) {
      return Response.json({ error: error.reason }, { status: 400 });
    }
    return mapTenantError(error);
  }
}
