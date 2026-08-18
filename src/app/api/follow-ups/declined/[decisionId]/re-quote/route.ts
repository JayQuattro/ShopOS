import { z } from "zod";

import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { reQuoteDeclinedLine, ReQuoteFailed } from "@/modules/followups/declined-work-service";

export const dynamic = "force-dynamic";

const schema = z.object({
  present: z.boolean().optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ decisionId: string }> },
): Promise<Response> {
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  try {
    const tenantContext = await getRequestContext();
    const { decisionId } = await context.params;
    const result = await reQuoteDeclinedLine({
      db,
      context: tenantContext,
      decisionId: decodeURIComponent(decisionId),
      ...(parsed.data.present !== undefined ? { present: parsed.data.present } : {}),
    });
    return Response.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ReQuoteFailed) {
      const statusMap: Record<string, number> = {
        decision_not_found: 404,
        change_order_pending_exists: 409,
        work_order_not_authorized: 400,
      };
      return Response.json({ error: error.reason }, { status: statusMap[error.reason] ?? 400 });
    }
    return mapTenantError(error);
  }
}
