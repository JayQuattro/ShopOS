import { z } from "zod";

import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";
import {
  BoardStageFailed,
  setWorkOrderBoardStage,
} from "@/modules/work-orders/board-stage-service";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ stageId: z.string().uuid().nullable() });

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

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const tenantContext = await getRequestContext();
    const { id } = await context.params;
    await setWorkOrderBoardStage({
      db,
      context: tenantContext,
      workOrderId: id,
      stageId: parsed.data.stageId,
    });
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof BoardStageFailed) {
      const statusMap: Record<string, number> = {
        work_order_not_found: 404,
        stage_not_found: 404,
      };
      return Response.json({ error: error.reason }, { status: statusMap[error.reason] ?? 400 });
    }
    return mapTenantError(error);
  }
}
