import { z } from "zod";

import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";
import {
  cancelTransportJob,
  completeTransportJob,
  getTransportJob,
  startTransportJob,
} from "@/modules/transport/transport-service";
import { transportError } from "../route";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ organizationId: string; transportJobId: string }> },
): Promise<Response> {
  try {
    const { organizationId, transportJobId } = await context.params;
    const tenantContext = await getRequestContext(organizationId);
    const job = await getTransportJob({ db, context: tenantContext, transportJobId });
    if (!job) return Response.json({ error: "transport_not_found" }, { status: 404 });

    return Response.json(
      {
        ...job,
        scheduledAt: job.scheduledAt?.toISOString() ?? null,
        startedAt: job.startedAt?.toISOString() ?? null,
        completedAt: job.completedAt?.toISOString() ?? null,
        cancelledAt: job.cancelledAt?.toISOString() ?? null,
        createdAt: job.createdAt.toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return mapTenantError(error);
  }
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("start"),
    driverUserId: z.string().uuid(),
    fleetAssetId: z.string().uuid().optional(),
  }),
  z.object({ action: z.literal("complete") }),
  z.object({
    action: z.literal("cancel"),
    reason: z.string().trim().min(3).max(500),
  }),
]);

export async function POST(
  request: Request,
  context: { params: Promise<{ organizationId: string; transportJobId: string }> },
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
    const { organizationId, transportJobId } = await context.params;
    const tenantContext = await getRequestContext(organizationId);

    if (parsed.data.action === "start") {
      await startTransportJob({
        db,
        context: tenantContext,
        transportJobId,
        driverUserId: parsed.data.driverUserId,
        ...(parsed.data.fleetAssetId ? { fleetAssetId: parsed.data.fleetAssetId } : {}),
      });
      return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    }

    if (parsed.data.action === "complete") {
      await completeTransportJob({ db, context: tenantContext, transportJobId });
      return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    }

    await cancelTransportJob({
      db,
      context: tenantContext,
      transportJobId,
      reason: parsed.data.reason,
    });
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return transportError(error);
  }
}
