import { z } from "zod";

import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";
import {
  createTaxRate,
  deactivateTaxRate,
  listTaxRates,
  TaxRateFailed,
} from "@/modules/taxes/tax-rate-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const tenantContext = await getRequestContext();
    const includeInactive = new URL(request.url).searchParams.get("all") === "1";
    const rates = await listTaxRates({
      db,
      context: tenantContext,
      ...(includeInactive ? { includeInactive } : {}),
    });
    return Response.json({ rates }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return taxError(error);
  }
}

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    name: z.string().trim().min(1).max(120),
    rateBasisPoints: z.number().int().min(0).max(10000),
    stackGroup: z.string().trim().max(60).optional(),
  }),
  z.object({ action: z.literal("deactivate"), taxRateId: z.string().uuid() }),
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
      const result = await createTaxRate({
        db,
        context: tenantContext,
        name: parsed.data.name,
        rateBasisPoints: parsed.data.rateBasisPoints,
        ...(parsed.data.stackGroup ? { stackGroup: parsed.data.stackGroup } : {}),
      });
      return Response.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
    }
    await deactivateTaxRate({ db, context: tenantContext, taxRateId: parsed.data.taxRateId });
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return taxError(error);
  }
}

function taxError(error: unknown): Response {
  if (error instanceof TaxRateFailed) {
    const statusMap: Record<string, number> = {
      tax_rate_not_found: 404,
      duplicate_name: 400,
    };
    return Response.json({ error: error.reason }, { status: statusMap[error.reason] ?? 400 });
  }
  return mapTenantError(error);
}
