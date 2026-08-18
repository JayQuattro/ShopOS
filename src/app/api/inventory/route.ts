import { z } from "zod";

import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";
import {
  adjustStock,
  createItem,
  InventoryFailed,
  listItems,
} from "@/modules/inventory/inventory-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const tenantContext = await getRequestContext();
    const lowOnly = new URL(request.url).searchParams.get("low") === "1";
    const items = await listItems({ db, context: tenantContext }, { lowOnly });
    return Response.json({ items }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return invError(error);
  }
}

const createSchema = z.object({
  action: z.literal("create"),
  partNumber: z.string().trim().min(1).max(120),
  name: z.string().trim().min(2).max(220),
  quantityOnHand: z.number().int().min(0).optional(),
  reorderPoint: z.number().int().min(0).optional(),
  unitCostMinor: z.number().int().min(0).optional(),
  currency: z.string().trim().length(3).optional(),
  binLocation: z.string().trim().max(80).optional(),
});

const adjustSchema = z.object({
  action: z.literal("adjust"),
  itemId: z.string().uuid(),
  delta: z
    .number()
    .int()
    .refine((v) => v !== 0, "must not be zero"),
  note: z.string().trim().max(500).optional(),
});

const bodySchema = z.discriminatedUnion("action", [createSchema, adjustSchema]);

export async function POST(request: Request): Promise<Response> {
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
    if (parsed.data.action === "create") {
      const result = await createItem({
        db,
        context: tenantContext,
        partNumber: parsed.data.partNumber,
        name: parsed.data.name,
        ...(parsed.data.quantityOnHand ? { quantityOnHand: parsed.data.quantityOnHand } : {}),
        ...(parsed.data.reorderPoint ? { reorderPoint: parsed.data.reorderPoint } : {}),
        ...(parsed.data.unitCostMinor ? { unitCostMinor: parsed.data.unitCostMinor } : {}),
        ...(parsed.data.currency ? { currency: parsed.data.currency } : {}),
        ...(parsed.data.binLocation ? { binLocation: parsed.data.binLocation } : {}),
      });
      return Response.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
    }
    const result = await adjustStock({
      db,
      context: tenantContext,
      itemId: parsed.data.itemId,
      delta: parsed.data.delta,
      ...(parsed.data.note ? { note: parsed.data.note } : {}),
    });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return invError(error);
  }
}

function invError(error: unknown): Response {
  if (error instanceof InventoryFailed) {
    const statusMap: Record<string, number> = {
      item_not_found: 404,
      insufficient_stock: 409,
      duplicate_part_number: 400,
    };
    return Response.json({ error: error.reason }, { status: statusMap[error.reason] ?? 400 });
  }
  return mapTenantError(error);
}
