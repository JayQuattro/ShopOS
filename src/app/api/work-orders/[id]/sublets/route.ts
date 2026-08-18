import { z } from "zod";

import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";
import {
  cancelSubletWork,
  listSubletsForWorkOrder,
  returnSubletWork,
  sendSubletWork,
  SubletFailed,
} from "@/modules/work-orders/sublet-service";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const tenantContext = await getRequestContext();
    const { id } = await context.params;
    const sublets = await listSubletsForWorkOrder({
      db,
      context: tenantContext,
      workOrderId: id,
    });
    return Response.json(
      {
        sublets: sublets.map((sublet) => ({
          ...sublet,
          sentAt: sublet.sentAt.toISOString(),
          returnedAt: sublet.returnedAt?.toISOString() ?? null,
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return subletError(error);
  }
}

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("send"),
    vendorName: z.string().trim().min(2).max(180),
    description: z.string().trim().min(3).max(1000),
    quotedMinor: z.number().int().min(0).optional(),
    note: z.string().trim().max(1000).optional(),
  }),
  z.object({
    action: z.literal("return"),
    subletId: z.string().uuid(),
    actualMinor: z.number().int().min(0).optional(),
  }),
  z.object({ action: z.literal("cancel"), subletId: z.string().uuid() }),
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
    if (parsed.data.action === "send") {
      const result = await sendSubletWork({
        db,
        context: tenantContext,
        workOrderId: id,
        vendorName: parsed.data.vendorName,
        description: parsed.data.description,
        ...(parsed.data.quotedMinor !== undefined ? { quotedMinor: parsed.data.quotedMinor } : {}),
        ...(parsed.data.note ? { note: parsed.data.note } : {}),
      });
      return Response.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
    }
    if (parsed.data.action === "return") {
      await returnSubletWork({
        db,
        context: tenantContext,
        subletId: parsed.data.subletId,
        ...(parsed.data.actualMinor !== undefined ? { actualMinor: parsed.data.actualMinor } : {}),
      });
      return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    }
    await cancelSubletWork({ db, context: tenantContext, subletId: parsed.data.subletId });
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return subletError(error);
  }
}

function subletError(error: unknown): Response {
  if (error instanceof SubletFailed) {
    const statusMap: Record<string, number> = {
      work_order_not_found: 404,
      sublet_not_found: 404,
      already_returned: 409,
      invalid_transition: 409,
    };
    return Response.json({ error: error.reason }, { status: statusMap[error.reason] ?? 400 });
  }
  return mapTenantError(error);
}
