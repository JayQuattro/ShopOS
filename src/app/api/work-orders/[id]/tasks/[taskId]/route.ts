import { z } from "zod";

import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { TaskFailed, updateTaskStatus } from "@/modules/work-orders/task-service";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  status: z.enum(["OPEN", "DONE", "NEEDS_ATTENTION", "SKIPPED"]),
  outcomeNote: z.string().trim().max(500).optional(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; taskId: string }> },
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const tenantContext = await getRequestContext();
    const { taskId } = await context.params;
    await updateTaskStatus({
      db,
      context: tenantContext,
      taskId,
      status: parsed.data.status,
      ...(parsed.data.outcomeNote !== undefined ? { outcomeNote: parsed.data.outcomeNote } : {}),
    });
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof TaskFailed) {
      return Response.json({ error: error.reason }, { status: 400 });
    }
    return mapTenantError(error);
  }
}
