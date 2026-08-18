import { z } from "zod";

import { db } from "@/db/client";
import {
  WorkOrderNotFound,
  WorkOrderRepository,
} from "@/modules/work-orders/work-order-repository";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";

export const dynamic = "force-dynamic";

const updateSchema = z.object({
  customerConcern: z.string().trim().min(1).max(2000).optional(),
  promisedAt: z.string().datetime().nullable().optional(),
  keyTag: z.string().trim().max(40).nullable().optional(),
  keyLocation: z.string().trim().max(80).nullable().optional(),
});

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const tenantContext = await getRequestContext();
    const { id } = await context.params;
    const repo = new WorkOrderRepository({ db, context: tenantContext });
    const workOrder = await repo.findById(id);
    if (!workOrder) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json({ workOrder }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapTenantError(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const tenantContext = await getRequestContext();
    const { id } = await context.params;
    const repo = new WorkOrderRepository({ db, context: tenantContext });
    await repo.update(id, {
      ...(parsed.data.customerConcern !== undefined
        ? { customerConcern: parsed.data.customerConcern }
        : {}),
      ...(parsed.data.promisedAt !== undefined
        ? { promisedAt: parsed.data.promisedAt ? new Date(parsed.data.promisedAt) : null }
        : {}),
      ...(parsed.data.keyTag !== undefined ? { keyTag: parsed.data.keyTag } : {}),
      ...(parsed.data.keyLocation !== undefined ? { keyLocation: parsed.data.keyLocation } : {}),
    });
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof WorkOrderNotFound) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    return mapTenantError(error);
  }
}
