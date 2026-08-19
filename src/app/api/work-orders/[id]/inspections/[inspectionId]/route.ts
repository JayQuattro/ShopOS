import { z } from "zod";

import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { recommendInspectionItemToEstimate } from "@/modules/work-orders/recommend-bridge-service";
import {
  addInspectionItem,
  completeInspection,
  InspectionFailed,
  setInspectionItemCondition,
  shareInspection,
} from "@/modules/work-orders/inspection-service";

export const dynamic = "force-dynamic";

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("add-item"),
    component: z.string().trim().min(1).max(160),
    zone: z.string().trim().max(80).optional(),
  }),
  z.object({
    action: z.literal("set-condition"),
    itemId: z.string().uuid(),
    condition: z.enum(["OK", "WATCH", "REPLACE", "NA"]),
    note: z.string().trim().max(2000).optional(),
  }),
  z.object({ action: z.literal("complete") }),
  z.object({ action: z.literal("recommend"), itemId: z.string().uuid() }),
  z.object({ action: z.literal("share") }),
]);

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; inspectionId: string }> },
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
    const tenantContext = await getRequestContext();
    const { id, inspectionId } = await context.params;
    void id; // the service scopes by inspection + organization

    if (parsed.data.action === "add-item") {
      const result = await addInspectionItem({
        db,
        context: tenantContext,
        inspectionId,
        component: parsed.data.component,
        ...(parsed.data.zone ? { zone: parsed.data.zone } : {}),
      });
      return Response.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
    }

    if (parsed.data.action === "set-condition") {
      await setInspectionItemCondition({
        db,
        context: tenantContext,
        itemId: parsed.data.itemId,
        condition: parsed.data.condition,
        ...(parsed.data.note !== undefined ? { note: parsed.data.note } : {}),
      });
      return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    }

    if (parsed.data.action === "recommend") {
      const result = await recommendInspectionItemToEstimate({
        db,
        context: tenantContext,
        inspectionItemId: parsed.data.itemId,
      });
      return Response.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
    }

    if (parsed.data.action === "complete") {
      await completeInspection({ db, context: tenantContext, inspectionId });
      return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    }

    const result = await shareInspection({ db, context: tenantContext, inspectionId });
    return Response.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof InspectionFailed) {
      const statusMap: Record<string, number> = {
        inspection_not_found: 404,
        item_not_found: 404,
        not_draft: 409,
        invalid_condition: 400,
      };
      return Response.json({ error: error.reason }, { status: statusMap[error.reason] ?? 400 });
    }
    return mapTenantError(error);
  }
}
