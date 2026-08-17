import { z } from "zod";

import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";
import {
  applyServiceTemplateToWorkOrder,
  ServiceTemplateFailed,
} from "@/modules/work-orders/service-template-service";

export const dynamic = "force-dynamic";

const applySchema = z.object({ templateId: z.string().uuid() });

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

  const parsed = applySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  try {
    const tenantContext = await getRequestContext();
    const { id } = await context.params;
    const result = await applyServiceTemplateToWorkOrder({
      db,
      context: tenantContext,
      workOrderId: id,
      templateId: parsed.data.templateId,
    });
    return Response.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ServiceTemplateFailed) {
      const status =
        error.reason === "template_not_found" || error.reason === "work_order_not_found"
          ? 404
          : 400;
      return Response.json({ error: error.reason }, { status });
    }
    return mapTenantError(error);
  }
}
