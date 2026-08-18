import { z } from "zod";

import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";
import {
  createTransportJob,
  listTransportJobs,
  TransportFailed,
} from "@/modules/transport/transport-service";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ organizationId: string }> },
): Promise<Response> {
  try {
    const { organizationId } = await context.params;
    const tenantContext = await getRequestContext(organizationId);
    const params = new URL(request.url).searchParams;

    const kindParam = params.get("kind");
    const driverParam = params.get("driverUserId");

    const jobs = await listTransportJobs({
      db,
      context: tenantContext,
      openOnly: params.get("openOnly") === "true",
      ...(kindParam === "PICKUP" || kindParam === "DELIVERY" ? { kind: kindParam } : {}),
      ...(driverParam ? { driverUserId: driverParam } : {}),
    });
    return Response.json(
      {
        transportJobs: jobs.map((job) => ({
          ...job,
          scheduledAt: job.scheduledAt?.toISOString() ?? null,
          startedAt: job.startedAt?.toISOString() ?? null,
          completedAt: job.completedAt?.toISOString() ?? null,
          cancelledAt: job.cancelledAt?.toISOString() ?? null,
          createdAt: job.createdAt.toISOString(),
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
  kind: z.enum(["PICKUP", "DELIVERY"]),
  contactPhone: z.string().trim().min(5).max(32),
  addressLine1: z.string().trim().min(3).max(220),
  addressLine2: z.string().trim().max(220).optional(),
  city: z.string().trim().min(1).max(120),
  stateProvince: z.string().trim().min(1).max(80),
  postalCode: z.string().trim().min(1).max(20),
  assetId: z.string().uuid().optional(),
  workOrderId: z.string().uuid().optional(),
  scheduledAt: z.string().datetime().optional(),
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
    const result = await createTransportJob({
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
      ...(parsed.data.assetId ? { assetId: parsed.data.assetId } : {}),
      ...(parsed.data.workOrderId ? { workOrderId: parsed.data.workOrderId } : {}),
      ...(parsed.data.scheduledAt ? { scheduledAt: new Date(parsed.data.scheduledAt) } : {}),
      ...(parsed.data.note ? { note: parsed.data.note } : {}),
    });
    return Response.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return transportError(error);
  }
}

export function transportError(error: unknown): Response {
  if (error instanceof TransportFailed) {
    const statusMap: Record<string, number> = {
      transport_not_found: 404,
      customer_not_found: 404,
      location_not_found: 404,
      asset_not_found: 404,
      work_order_not_found: 404,
      driver_not_a_member: 400,
      invalid_transition: 409,
    };
    return Response.json({ error: error.reason }, { status: statusMap[error.reason] ?? 400 });
  }
  return mapTenantError(error);
}
