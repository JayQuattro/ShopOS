import { z } from "zod";

import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";
import {
  addTask,
  createChangeOrderFromFlaggedTasks,
  listTasks,
  TaskFailed,
} from "@/modules/work-orders/task-service";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const tenantContext = await getRequestContext();
    const { id } = await context.params;
    const tasks = await listTasks({ db, context: tenantContext, workOrderId: id });
    return Response.json({ tasks }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof TaskFailed) {
      return Response.json({ error: error.reason }, { status: 404 });
    }
    return mapTenantError(error);
  }
}

const postSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("add"),
    title: z.string().trim().min(3).max(200),
    outcomeNote: z.string().trim().max(500).optional(),
  }),
  z.object({
    action: z.literal("convert-flagged"),
  }),
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

  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const tenantContext = await getRequestContext();
    const { id } = await context.params;

    if (parsed.data.action === "add") {
      const result = await addTask({
        db,
        context: tenantContext,
        workOrderId: id,
        title: parsed.data.title,
        ...(parsed.data.outcomeNote ? { outcomeNote: parsed.data.outcomeNote } : {}),
      });
      return Response.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
    }

    const result = await createChangeOrderFromFlaggedTasks({
      db,
      context: tenantContext,
      workOrderId: id,
    });
    return Response.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof TaskFailed) {
      const statusMap: Record<string, number> = {
        no_flagged_tasks: 400,
        work_order_not_authorized: 400,
        change_order_pending_exists: 400,
      };
      const status = statusMap[error.reason] ?? 404;
      return Response.json({ error: error.reason }, { status });
    }
    return mapTenantError(error);
  }
}
