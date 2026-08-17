import { z } from "zod";

import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";
import {
  assignTechnician,
  AssignmentFailed,
  listAssignableTechnicians,
  unassignTechnician,
} from "@/modules/work-orders/assignment-service";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  _context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const tenantContext = await getRequestContext();
    const technicians = await listAssignableTechnicians({
      db,
      context: tenantContext,
    });
    return Response.json({ technicians }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapTenantError(error);
  }
}

const assignmentSchema = z.object({
  // null clears the assignment.
  userId: z.string().uuid().nullable(),
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

  const parsed = assignmentSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const tenantContext = await getRequestContext();
    const { id } = await context.params;
    if (parsed.data.userId === null) {
      await unassignTechnician({ db, context: tenantContext, workOrderId: id });
    } else {
      await assignTechnician({
        db,
        context: tenantContext,
        workOrderId: id,
        userId: parsed.data.userId,
      });
    }
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AssignmentFailed) {
      return Response.json({ error: error.reason }, { status: 400 });
    }
    return mapTenantError(error);
  }
}
