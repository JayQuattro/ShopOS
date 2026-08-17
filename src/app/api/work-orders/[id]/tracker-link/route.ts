import { z } from "zod";

import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";
import {
  getOrCreateTrackerLink,
  getTrackerLinkStatus,
  regenerateTrackerLink,
  revokeTrackerLink,
  TrackerLinkFailed,
} from "@/modules/work-orders/tracker-link-service";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const tenantContext = await getRequestContext();
    const { id } = await context.params;
    const status = await getTrackerLinkStatus({ db, context: tenantContext, workOrderId: id });
    return Response.json(status, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapTenantError(error);
  }
}

const actionSchema = z.enum(["get-or-create", "regenerate", "revoke"]);

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  const parsed = actionSchema.safeParse((body as { action?: unknown })?.action);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  try {
    const tenantContext = await getRequestContext();
    const { id } = await context.params;

    if (parsed.data === "get-or-create") {
      const result = await getOrCreateTrackerLink({ db, context: tenantContext, workOrderId: id });
      return Response.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
    }
    if (parsed.data === "regenerate") {
      const result = await regenerateTrackerLink({ db, context: tenantContext, workOrderId: id });
      return Response.json(result, { headers: { "Cache-Control": "no-store" } });
    }
    await revokeTrackerLink({ db, context: tenantContext, workOrderId: id });
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof TrackerLinkFailed) {
      const statusMap: Record<string, number> = {
        work_order_not_found: 404,
        link_not_found: 404,
        link_revoked: 409,
      };
      return Response.json({ error: error.reason }, { status: statusMap[error.reason] ?? 400 });
    }
    return mapTenantError(error);
  }
}
