import { z } from "zod";

import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";
import {
  applyTemplateLineToChangeOrder,
  ServiceTemplateFailed,
} from "@/modules/work-orders/service-template-service";

export const dynamic = "force-dynamic";

const schema = z.object({ templateLineId: z.string().uuid() });

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

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  try {
    const tenantContext = await getRequestContext();
    const { id } = await context.params;
    const result = await applyTemplateLineToChangeOrder({
      db,
      context: tenantContext,
      workOrderId: id,
      templateLineId: parsed.data.templateLineId,
    });
    return Response.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ServiceTemplateFailed) {
      const statusMap: Record<string, number> = {
        template_not_found: 404,
        work_order_not_found: 404,
      };
      return Response.json({ error: error.reason }, { status: statusMap[error.reason] ?? 400 });
    }
    return mapTenantError(error);
  }
}
