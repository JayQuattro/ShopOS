import { z } from "zod";

import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";
import {
  createServiceCall,
  listServiceCalls,
  ServiceCallFailed,
} from "@/modules/service-calls/service-call-service";
import type { ServiceCallStatus } from "@/modules/service-calls/service-call-state-machine";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ organizationId: string }> },
): Promise<Response> {
  try {
    const { organizationId } = await context.params;
    const tenantContext = await getRequestContext(organizationId);
    const params = new URL(request.url).searchParams;

    const statusParam = params.get("status");
    const technicianParam = params.get("technicianUserId");

    const calls = await listServiceCalls({
      db,
      context: tenantContext,
      openOnly: params.get("openOnly") === "true",
      ...(statusParam ? { status: statusParam as ServiceCallStatus } : {}),
      ...(technicianParam ? { technicianUserId: technicianParam } : {}),
    });
    return Response.json(
      {
        serviceCalls: calls.map((call) => ({
          ...call,
          dispatchedAt: call.dispatchedAt?.toISOString() ?? null,
          enRouteAt: call.enRouteAt?.toISOString() ?? null,
          onSceneAt: call.onSceneAt?.toISOString() ?? null,
          completedAt: call.completedAt?.toISOString() ?? null,
          cancelledAt: call.cancelledAt?.toISOString() ?? null,
          createdAt: call.createdAt.toISOString(),
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return mapTenantError(error);
  }
}

const createSchema = z.object({
  locationId: z.string().uuid(),
  customerId: z.string().uuid(),
  kind: z.enum([
    "JUMPSTART",
    "TIRE_CHANGE",
    "FUEL_DELIVERY",
    "LOCKOUT",
    "BATTERY",
    "TOW_COORDINATION",
    "MOBILE_REPAIR",
    "OTHER",
  ]),
  contactPhone: z.string().trim().min(5).max(32),
  addressLine1: z.string().trim().min(3).max(220),
  addressLine2: z.string().trim().max(220).optional(),
  city: z.string().trim().min(1).max(120),
  stateProvince: z.string().trim().min(1).max(80),
  postalCode: z.string().trim().min(1).max(20),
  note: z.string().trim().max(2000).optional(),
});

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

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const { organizationId } = await context.params;
    const tenantContext = await getRequestContext(organizationId);
    const result = await createServiceCall({
      db,
      context: tenantContext,
      locationId: parsed.data.locationId,
      customerId: parsed.data.customerId,
      kind: parsed.data.kind,
      contactPhone: parsed.data.contactPhone,
      addressLine1: parsed.data.addressLine1,
      ...(parsed.data.addressLine2 ? { addressLine2: parsed.data.addressLine2 } : {}),
      city: parsed.data.city,
      stateProvince: parsed.data.stateProvince,
      postalCode: parsed.data.postalCode,
      ...(parsed.data.note ? { note: parsed.data.note } : {}),
    });
    return Response.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return serviceCallError(error);
  }
}

export function serviceCallError(error: unknown): Response {
  if (error instanceof ServiceCallFailed) {
    const statusMap: Record<string, number> = {
      service_call_not_found: 404,
      customer_not_found: 404,
      location_not_found: 404,
      asset_not_found: 404,
      technician_not_a_member: 400,
      already_converted: 409,
      terminal_state: 409,
      invalid_transition: 409,
    };
    return Response.json({ error: error.reason }, { status: statusMap[error.reason] ?? 400 });
  }
  return mapTenantError(error);
}
