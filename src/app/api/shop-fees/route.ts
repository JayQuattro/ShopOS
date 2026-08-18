import { z } from "zod";

import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";
import {
  createShopFee,
  deactivateShopFee,
  listShopFees,
  ShopFeeFailed,
} from "@/modules/taxes/shop-fee-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const tenantContext = await getRequestContext();
    const includeInactive = new URL(request.url).searchParams.get("all") === "1";
    const fees = await listShopFees(db, tenantContext, {
      ...(includeInactive ? { includeInactive } : {}),
    });
    return Response.json({ fees }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return feeError(error);
  }
}

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    name: z.string().trim().min(1).max(120),
    calculation: z.enum(["FLAT", "PERCENT_OF_LABOR"]),
    amountMinor: z.number().int().min(0),
    rateBasisPoints: z.number().int().min(0).max(10000),
    maxAmountMinor: z.number().int().min(0).optional(),
    taxable: z.boolean(),
    taxRateBasisPoints: z.number().int().min(0).max(10000),
    appliesTo: z.enum(["BASELINE", "CHANGE_ORDER", "BOTH"]),
  }),
  z.object({ action: z.literal("deactivate"), feeId: z.string().uuid() }),
]);

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
      const result = await createShopFee(db, tenantContext, {
        name: parsed.data.name,
        calculation: parsed.data.calculation,
        amountMinor: parsed.data.amountMinor,
        rateBasisPoints: parsed.data.rateBasisPoints,
        ...(parsed.data.maxAmountMinor !== undefined
          ? { maxAmountMinor: parsed.data.maxAmountMinor }
          : {}),
        taxable: parsed.data.taxable,
        taxRateBasisPoints: parsed.data.taxRateBasisPoints,
        appliesTo: parsed.data.appliesTo,
      });
      return Response.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
    }
    await deactivateShopFee(db, tenantContext, parsed.data.feeId);
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return feeError(error);
  }
}

function feeError(error: unknown): Response {
  if (error instanceof ShopFeeFailed) {
    const statusMap: Record<string, number> = {
      fee_not_found: 404,
      duplicate_name: 400,
    };
    return Response.json({ error: error.reason }, { status: statusMap[error.reason] ?? 400 });
  }
  return mapTenantError(error);
}
