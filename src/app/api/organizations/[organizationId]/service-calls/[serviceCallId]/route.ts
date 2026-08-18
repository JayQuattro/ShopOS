import { z } from "zod";

import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";
import {
  advanceServiceCallStatus,
  cancelServiceCall,
  convertServiceCallToWorkOrder,
  dispatchServiceCall,
  getServiceCall,
} from "@/modules/service-calls/service-call-service";
import { serviceCallError } from "../route";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ organizationId: string; serviceCallId: string }> },
): Promise<Response> {
  try {
    const { organizationId, serviceCallId } = await context.params;
    const tenantContext = await getRequestContext(organizationId);
    const call = await getServiceCall({ db, context: tenantContext, serviceCallId });
    if (!call) return Response.json({ error: "service_call_not_found" }, { status: 404 });

    return Response.json(
      {
        ...call,
        dispatchedAt: call.dispatchedAt?.toISOString() ?? null,
        enRouteAt: call.enRouteAt?.toISOString() ?? null,
        onSceneAt: call.onSceneAt?.toISOString() ?? null,
        completedAt: call.completedAt?.toISOString() ?? null,
        cancelledAt: call.cancelledAt?.toISOString() ?? null,
        createdAt: call.createdAt.toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return mapTenantError(error);
  }
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("dispatch"),
    technicianUserId: z.string().uuid(),
    fleetAssetId: z.string().uuid().optional(),
  }),
  z.object({
    action: z.literal("advance"),
    target: z.enum(["EN_ROUTE", "ON_SCENE", "COMPLETED"]),
  }),
  z.object({
    action: z.literal("cancel"),
    reason: z.string().trim().min(3).max(500),
  }),
  z.object({
    action: z.literal("convert"),
    assetId: z.string().uuid().optional(),
  }),
]);

export async function POST(
  request: Request,
  context: { params: Promise<{ organizationId: string; serviceCallId: string }> },
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
    const { organizationId, serviceCallId } = await context.params;
    const tenantContext = await getRequestContext(organizationId);

    if (parsed.data.action === "dispatch") {
      await dispatchServiceCall({
        db,
        context: tenantContext,
        serviceCallId,
        technicianUserId: parsed.data.technicianUserId,
        ...(parsed.data.fleetAssetId ? { fleetAssetId: parsed.data.fleetAssetId } : {}),
      });
      return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    }

    if (parsed.data.action === "advance") {
      await advanceServiceCallStatus({
        db,
        context: tenantContext,
        serviceCallId,
        target: parsed.data.target,
      });
      return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    }

    if (parsed.data.action === "cancel") {
      await cancelServiceCall({
        db,
        context: tenantContext,
        serviceCallId,
        reason: parsed.data.reason,
      });
      return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    }

    const converted = await convertServiceCallToWorkOrder({
      db,
      context: tenantContext,
      serviceCallId,
      ...(parsed.data.assetId ? { assetId: parsed.data.assetId } : {}),
    });
    return Response.json(converted, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return serviceCallError(error);
  }
}
