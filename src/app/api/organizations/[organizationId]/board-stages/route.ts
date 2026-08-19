import { z } from "zod";

import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";
import {
  BoardStageFailed,
  createBoardStage,
  deactivateBoardStage,
  listBoardStages,
  updateBoardStage,
} from "@/modules/work-orders/board-stage-service";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ organizationId: string }> },
): Promise<Response> {
  try {
    const { organizationId } = await context.params;
    const tenantContext = await getRequestContext(organizationId);
    const stages = await listBoardStages({ db, context: tenantContext });
    return Response.json({ stages }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return stageError(error);
  }
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    label: z.string().trim().min(1).max(60),
    key: z.string().trim().max(40).optional(),
    colorHint: z.string().trim().max(20).optional(),
  }),
  z.object({
    action: z.literal("update"),
    stageId: z.string().uuid(),
    label: z.string().trim().min(1).max(60).optional(),
    colorHint: z.string().trim().max(20).nullable().optional(),
  }),
  z.object({ action: z.literal("deactivate"), stageId: z.string().uuid() }),
]);

export async function POST(
  request: Request,
  context: { params: Promise<{ organizationId: string }> },
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const { organizationId } = await context.params;
    const tenantContext = await getRequestContext(organizationId);

    if (parsed.data.action === "create") {
      const result = await createBoardStage({
        db,
        context: tenantContext,
        label: parsed.data.label,
        ...(parsed.data.key ? { key: parsed.data.key } : {}),
        ...(parsed.data.colorHint ? { colorHint: parsed.data.colorHint } : {}),
      });
      return Response.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
    }

    if (parsed.data.action === "update") {
      await updateBoardStage({
        db,
        context: tenantContext,
        stageId: parsed.data.stageId,
        ...(parsed.data.label !== undefined ? { label: parsed.data.label } : {}),
        ...(parsed.data.colorHint !== undefined ? { colorHint: parsed.data.colorHint } : {}),
      });
      return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    }

    await deactivateBoardStage({ db, context: tenantContext, stageId: parsed.data.stageId });
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return stageError(error);
  }
}

function stageError(error: unknown): Response {
  if (error instanceof BoardStageFailed) {
    const statusMap: Record<string, number> = {
      stage_not_found: 404,
      work_order_not_found: 404,
      duplicate_key: 409,
      invalid_label: 400,
      invalid_key: 400,
    };
    return Response.json({ error: error.reason }, { status: statusMap[error.reason] ?? 400 });
  }
  return mapTenantError(error);
}
