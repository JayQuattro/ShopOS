import { z } from "zod";

import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";
import {
  addManualEntry,
  deleteTimeEntry,
  listTimeEntries,
  runningTimer,
  startTimer,
  stopTimer,
  TimeEntryFailed,
} from "@/modules/time-tracking/time-entry-service";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const tenantContext = await getRequestContext();
    const { id } = await context.params;
    const [entries, running] = await Promise.all([
      listTimeEntries({ db, context: tenantContext, workOrderId: id }),
      runningTimer({ db, context: tenantContext }),
    ]);
    return Response.json(
      {
        entries: entries.map((entry) => ({
          ...entry,
          startedAt: entry.startedAt.toISOString(),
          endedAt: entry.endedAt?.toISOString() ?? null,
        })),
        runningOnThisWorkOrder: running?.workOrderId === id,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof TimeEntryFailed) {
      return Response.json({ error: error.reason }, { status: 400 });
    }
    return mapTenantError(error);
  }
}

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), note: z.string().trim().max(500).optional() }),
  z.object({ action: z.literal("stop") }),
  z.object({
    action: z.literal("manual"),
    userId: z.string().uuid(),
    startedAt: z.string().datetime(),
    endedAt: z.string().datetime(),
    note: z.string().trim().max(500).optional(),
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

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const tenantContext = await getRequestContext();
    const { id } = await context.params;

    if (parsed.data.action === "start") {
      const result = await startTimer({
        db,
        context: tenantContext,
        workOrderId: id,
        ...(parsed.data.note ? { note: parsed.data.note } : {}),
      });
      return Response.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
    }

    if (parsed.data.action === "stop") {
      const result = await stopTimer({ db, context: tenantContext, workOrderId: id });
      return Response.json(result, { headers: { "Cache-Control": "no-store" } });
    }

    const result = await addManualEntry({
      db,
      context: tenantContext,
      workOrderId: id,
      userId: parsed.data.userId,
      startedAt: new Date(parsed.data.startedAt),
      endedAt: new Date(parsed.data.endedAt),
      ...(parsed.data.note ? { note: parsed.data.note } : {}),
    });
    return Response.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof TimeEntryFailed) {
      return Response.json({ error: error.reason }, { status: 400 });
    }
    return mapTenantError(error);
  }
}

export async function DELETE(
  request: Request,
  _context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const entryId = new URL(request.url).searchParams.get("entryId");
  if (!entryId) return Response.json({ error: "missing_entryId" }, { status: 400 });

  try {
    const tenantContext = await getRequestContext();
    await deleteTimeEntry({ db, context: tenantContext, entryId });
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof TimeEntryFailed) {
      return Response.json({ error: error.reason }, { status: 404 });
    }
    return mapTenantError(error);
  }
}
