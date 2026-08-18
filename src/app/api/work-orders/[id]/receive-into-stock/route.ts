import { z } from "zod";

import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { InventoryFailed, receiveIntoStock } from "@/modules/inventory/inventory-service";

export const dynamic = "force-dynamic";

const schema = z.object({
  partNumber: z.string().trim().min(1).max(120),
  name: z.string().trim().min(2).max(220),
  quantity: z.number().int().min(1),
  unitCostMinor: z.number().int().min(0),
  currency: z.string().trim().length(3).optional(),
  binLocation: z.string().trim().max(80).optional(),
});

export async function POST(
  request: Request,
  _context: { params: Promise<{ id: string }> },
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
    const result = await receiveIntoStock({
      db,
      context: tenantContext,
      partNumber: parsed.data.partNumber,
      name: parsed.data.name,
      quantity: parsed.data.quantity,
      unitCostMinor: parsed.data.unitCostMinor,
      ...(parsed.data.currency ? { currency: parsed.data.currency } : {}),
      ...(parsed.data.binLocation ? { binLocation: parsed.data.binLocation } : {}),
    });
    return Response.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof InventoryFailed) {
      return Response.json({ error: error.reason }, { status: 400 });
    }
    return mapTenantError(error);
  }
}
