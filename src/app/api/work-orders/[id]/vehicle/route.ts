import { z } from "zod";

import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { setVehicleStage, StagingFailed } from "@/modules/work-orders/vehicle-staging-service";

export const dynamic = "force-dynamic";

const schema = z.object({
  stage: z
    .enum([
      "WAITING",
      "IN_BAY",
      "ON_LIFT",
      "TEST_DRIVE",
      "WAITING_PARTS",
      "READY_FOR_PICKUP",
      "PICKED_UP",
    ])
    .nullable()
    .optional(),
  bayLabel: z.string().trim().max(60).nullable().optional(),
});

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const tenantContext = await getRequestContext();
    const { id } = await context.params;
    await setVehicleStage({
      db,
      context: tenantContext,
      workOrderId: id,
      ...(parsed.data.stage !== undefined ? { stage: parsed.data.stage } : {}),
      ...(parsed.data.bayLabel !== undefined ? { bayLabel: parsed.data.bayLabel } : {}),
    });
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof StagingFailed) {
      const status = error.reason === "work_order_not_found" ? 404 : 400;
      return Response.json({ error: error.reason }, { status });
    }
    return mapTenantError(error);
  }
}
