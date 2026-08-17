import { z } from "zod";

import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { ChangeOrderFailed, createChangeOrder } from "@/modules/estimates/change-order-service";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  note: z.string().trim().min(3).max(1000),
});

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

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const tenantContext = await getRequestContext();
    const { id } = await context.params;
    const result = await createChangeOrder({
      db,
      context: tenantContext,
      workOrderId: id,
      note: parsed.data.note,
    });
    return Response.json(result, {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof ChangeOrderFailed) {
      return Response.json({ error: error.reason }, { status: 400 });
    }
    return mapTenantError(error);
  }
}
