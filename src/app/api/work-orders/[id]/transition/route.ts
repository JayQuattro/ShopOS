import { z } from "zod";

import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";
import {
  transitionStatus,
  WorkOrderTransitionFailed,
} from "@/modules/work-orders/work-order-service";
import { InvalidStatusTransition } from "@/modules/work-orders/work-order-state-machine";

export const dynamic = "force-dynamic";

const transitionSchema = z.object({
  status: z.enum([
    "DRAFT",
    "ESTIMATING",
    "AWAITING_AUTHORIZATION",
    "AUTHORIZED",
    "IN_PROGRESS",
    "BLOCKED",
    "COMPLETED",
    "INVOICED",
    "CLOSED",
    "CANCELLED",
  ]),
});

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

  const parsed = transitionSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const tenantContext = await getRequestContext();
    const { id } = await context.params;
    await transitionStatus({
      db,
      context: tenantContext,
      workOrderId: id,
      targetStatus: parsed.data.status,
    });
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof InvalidStatusTransition) {
      return Response.json(
        { error: "invalid_transition", from: error.from, to: error.to },
        { status: 409 },
      );
    }
    if (error instanceof WorkOrderTransitionFailed) {
      const status = error.reason === "work_order_not_found" ? 404 : 409;
      return Response.json({ error: error.reason }, { status });
    }
    return mapTenantError(error);
  }
}
