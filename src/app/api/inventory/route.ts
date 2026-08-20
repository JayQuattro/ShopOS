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
    const params = new URL(request.url).searchParams;
    const items = await listItems(
      { db, context: tenantContext },
      {
        lowOnly: params.get("low") === "1",
        ...(params.get("locationId") ? { locationId: params.get("locationId")! } : {}),
        ...(params.get("categoryId") ? { categoryId: params.get("categoryId")! } : {}),
        ...(params.get("oeNumber") ? { oeNumber: params.get("oeNumber")! } : {}),
        ...(params.get("consumables") === "1" ? { consumablesOnly: true } : {}),
      },
    );
    return Response.json({ items }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return invError(error);
  }
}

const createSchema = z.object({
  action: z.literal("create"),
  partNumber: z.string().trim().min(1).max(120),
  name: z.string().trim().min(2).max(220),
  locationId: z.string().uuid().nullable().optional(),
  oeNumber: z.string().trim().max(120).optional(),
  brand: z.string().trim().max(120).optional(),
  categoryId: z.string().uuid().optional(),
  uomGroup: z.string().trim().max(60).optional(),
  unitOfMeasure: z.string().trim().max(40).optional(),
  uomFactorMilli: z.number().int().positive().optional(),
  condition: z.enum(["new", "used", "refurb"]).optional(),
  hasCore: z.boolean().optional(),
  coreValueMinor: z.number().int().min(0).optional(),
  consumable: z.boolean().optional(),
  nonSaleable: z.boolean().optional(),
  quantityOnHand: z.number().int().min(0).optional(),
  reorderPoint: z.number().int().min(0).optional(),
  unitCostMinor: z.number().int().min(0).optional(),
  currency: z.string().trim().length(3).optional(),
  binLocation: z.string().trim().max(80).optional(),
  notes: z.string().trim().max(2000).optional(),
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
        ...(parsed.data.locationId !== undefined ? { locationId: parsed.data.locationId } : {}),
        ...(parsed.data.oeNumber ? { oeNumber: parsed.data.oeNumber } : {}),
        ...(parsed.data.brand ? { brand: parsed.data.brand } : {}),
        ...(parsed.data.categoryId ? { categoryId: parsed.data.categoryId } : {}),
        ...(parsed.data.uomGroup ? { uomGroup: parsed.data.uomGroup } : {}),
        ...(parsed.data.unitOfMeasure ? { unitOfMeasure: parsed.data.unitOfMeasure } : {}),
        ...(parsed.data.uomFactorMilli !== undefined
          ? { uomFactorMilli: parsed.data.uomFactorMilli }
          : {}),
        ...(parsed.data.condition ? { condition: parsed.data.condition } : {}),
        ...(parsed.data.hasCore !== undefined ? { hasCore: parsed.data.hasCore } : {}),
        ...(parsed.data.coreValueMinor !== undefined
          ? { coreValueMinor: parsed.data.coreValueMinor }
          : {}),
        ...(parsed.data.consumable !== undefined ? { consumable: parsed.data.consumable } : {}),
        ...(parsed.data.nonSaleable !== undefined ? { nonSaleable: parsed.data.nonSaleable } : {}),
        ...(parsed.data.quantityOnHand ? { quantityOnHand: parsed.data.quantityOnHand } : {}),
        ...(parsed.data.reorderPoint ? { reorderPoint: parsed.data.reorderPoint } : {}),
        ...(parsed.data.unitCostMinor ? { unitCostMinor: parsed.data.unitCostMinor } : {}),
        ...(parsed.data.currency ? { currency: parsed.data.currency } : {}),
        ...(parsed.data.binLocation ? { binLocation: parsed.data.binLocation } : {}),
        ...(parsed.data.notes ? { notes: parsed.data.notes } : {}),
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
