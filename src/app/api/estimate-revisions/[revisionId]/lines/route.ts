import { z } from "zod";

import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { addLine, EstimateFailed, removeLine } from "@/modules/estimates/estimate-service";

export const dynamic = "force-dynamic";

const addLineSchema = z.object({
  kind: z.enum(["LABOR", "PART", "FEE"]),
  serviceGroupKey: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(500),
  quantityMilli: z.number().int().min(0),
  unitPriceMinor: z.number().int().min(0),
  discountMinor: z.number().int().min(0).default(0),
  taxable: z.boolean(),
  taxRateBasisPoints: z.number().int().min(0),
  position: z.number().int().min(1),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ revisionId: string }> },
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  const parsed = addLineSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const tenantContext = await getRequestContext();
    const { revisionId } = await context.params;
    const result = await addLine({
      db,
      context: tenantContext,
      revisionId,
      kind: parsed.data.kind,
      serviceGroupKey: parsed.data.serviceGroupKey,
      description: parsed.data.description,
      quantityMilli: parsed.data.quantityMilli,
      unitPriceMinor: parsed.data.unitPriceMinor,
      discountMinor: parsed.data.discountMinor,
      taxable: parsed.data.taxable,
      taxRateBasisPoints: parsed.data.taxRateBasisPoints,
      position: parsed.data.position,
    });
    return Response.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof EstimateFailed) {
      return Response.json({ error: error.reason }, { status: 400 });
    }
    return mapTenantError(error);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ revisionId: string }> },
): Promise<Response> {
  const url = new URL(request.url);
  const lineId = url.searchParams.get("lineId");
  if (!lineId) return Response.json({ error: "missing_lineId" }, { status: 400 });

  try {
    const tenantContext = await getRequestContext();
    const { revisionId } = await context.params;
    await removeLine({ db, context: tenantContext, revisionId, lineId });
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof EstimateFailed) {
      return Response.json({ error: error.reason }, { status: 400 });
    }
    return mapTenantError(error);
  }
}
