import { z } from "zod";

import { db } from "@/db/client";
import {
  WorkOrderCreateFailed,
  WorkOrderRepository,
  type CreateWorkOrderInput,
} from "@/modules/work-orders/work-order-repository";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  customerId: z.string().uuid(),
  assetId: z.string().uuid(),
  locationId: z.string().uuid(),
  workType: z.enum(["REPAIR", "MAINTENANCE", "PROJECT"]).optional(),
  customerConcern: z.string().trim().min(1).max(2000),
  promisedAt: z.string().datetime().optional(),
});

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const status = url.searchParams.get("status") ?? undefined;
  const customerId = url.searchParams.get("customerId") ?? undefined;
  const search = url.searchParams.get("search") ?? undefined;

  try {
    const context = await getRequestContext();
    const repo = new WorkOrderRepository({ db, context });
    const workOrders = await repo.list({
      ...(status ? { status } : {}),
      ...(customerId ? { customerId } : {}),
      ...(search ? { search } : {}),
    });
    return Response.json({ workOrders }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapTenantError(error);
  }
}

export async function POST(request: Request): Promise<Response> {
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
    const context = await getRequestContext();
    const repo = new WorkOrderRepository({ db, context });
    const data: Record<string, unknown> = {
      customerId: parsed.data.customerId,
      assetId: parsed.data.assetId,
      locationId: parsed.data.locationId,
      customerConcern: parsed.data.customerConcern,
    };
    if (parsed.data.workType) data.workType = parsed.data.workType;
    if (parsed.data.promisedAt) data.promisedAt = new Date(parsed.data.promisedAt);

    const workOrder = await repo.create(data as CreateWorkOrderInput);
    return Response.json(
      { workOrder },
      {
        status: 201,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    if (error instanceof WorkOrderCreateFailed) {
      return Response.json({ error: error.reason }, { status: 400 });
    }
    return mapTenantError(error);
  }
}
