import { z } from "zod";

import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";
import {
  createReorderFromSuggestions,
  listReorderSuggestions,
  ReorderFailed,
} from "@/modules/inventory/inventory-service";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const tenantContext = await getRequestContext();
    const suggestions = await listReorderSuggestions({ db, context: tenantContext });
    return Response.json({ suggestions }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return reorderError(error);
  }
}

const createSchema = z.object({
  workOrderId: z.string().uuid(),
  itemIds: z.array(z.string().uuid()).min(1),
  supplierId: z.string().uuid().optional(),
});

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
    const tenantContext = await getRequestContext();
    const result = await createReorderFromSuggestions({
      db,
      context: tenantContext,
      workOrderId: parsed.data.workOrderId,
      itemIds: parsed.data.itemIds,
      ...(parsed.data.supplierId ? { supplierId: parsed.data.supplierId } : {}),
    });
    return Response.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return reorderError(error);
  }
}

function reorderError(error: unknown): Response {
  if (error instanceof ReorderFailed) {
    const statusMap: Record<string, number> = {
      work_order_not_found: 404,
      item_not_found: 404,
      supplier_not_found: 400,
      nothing_to_order: 400,
    };
    return Response.json({ error: error.reason }, { status: statusMap[error.reason] ?? 400 });
  }
  return mapTenantError(error);
}
