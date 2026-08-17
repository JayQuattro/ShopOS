import { z } from "zod";

import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";
import {
  failQualityCheck,
  getQualityCheckState,
  passQualityCheck,
  QualityCheckFailed,
} from "@/modules/work-orders/quality-check-service";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const tenantContext = await getRequestContext();
    const { id } = await context.params;
    const state = await getQualityCheckState({ db, context: tenantContext, workOrderId: id });
    return Response.json(
      { ...state, passedAt: state.passedAt?.toISOString() ?? null },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof QualityCheckFailed) {
      return Response.json({ error: error.reason }, { status: 404 });
    }
    return mapTenantError(error);
  }
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("pass"), note: z.string().trim().max(2000).optional() }),
  z.object({ action: z.literal("fail"), note: z.string().trim().min(3).max(2000) }),
]);

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

  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const tenantContext = await getRequestContext();
    const { id } = await context.params;
    if (parsed.data.action === "pass") {
      await passQualityCheck({
        db,
        context: tenantContext,
        workOrderId: id,
        ...(parsed.data.note ? { note: parsed.data.note } : {}),
      });
    } else {
      await failQualityCheck({
        db,
        context: tenantContext,
        workOrderId: id,
        note: parsed.data.note,
      });
    }
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof QualityCheckFailed) {
      const statusMap: Record<string, number> = {
        work_order_not_found: 404,
        already_passed: 409,
        open_tasks: 400,
        invalid_note: 400,
      };
      return Response.json({ error: error.reason }, { status: statusMap[error.reason] ?? 400 });
    }
    return mapTenantError(error);
  }
}
