import { z } from "zod";

import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";
import {
  listAssistingTechnicians,
  setAssistingTechnicians,
  TechnicianTeamFailed,
} from "@/modules/work-orders/assignment-service";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const tenantContext = await getRequestContext();
    const { id } = await context.params;
    const technicians = await listAssistingTechnicians({
      db,
      context: tenantContext,
      workOrderId: id,
    });
    return Response.json({ technicians }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapTenantError(error);
  }
}

const putSchema = z.object({
  userIds: z.array(z.string().uuid()).max(20),
});

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

  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const tenantContext = await getRequestContext();
    const { id } = await context.params;
    await setAssistingTechnicians({
      db,
      context: tenantContext,
      workOrderId: id,
      userIds: parsed.data.userIds,
    });
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof TechnicianTeamFailed) {
      const status = error.reason === "work_order_not_found" ? 404 : 400;
      return Response.json({ error: error.reason }, { status });
    }
    return mapTenantError(error);
  }
}
