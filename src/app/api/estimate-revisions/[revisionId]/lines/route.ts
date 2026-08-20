import { z } from "zod";

import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { addLine, EstimateFailed, removeLine } from "@/modules/estimates/estimate-service";

export const dynamic = "force-dynamic";

const addLineSchema = z
  .object({
    kind: z.enum(["LABOR", "PART", "FEE"]),
    serviceGroupKey: z.string().trim().min(1).max(80),
    description: z.string().trim().min(1).max(500),
    quantityMilli: z.number().int().min(0),
    // Negative unit prices are credit lines, allowed only on change orders
    // (ADR 0014); the service rejects them for baseline revisions.
    unitPriceMinor: z.number().int(),
    discountMinor: z.number().int().min(0).default(0),
    taxable: z.boolean(),
    taxRateBasisPoints: z.number().int().min(0),
    taxRateId: z.string().uuid().optional(),
    position: z.number().int().min(1),
    // Option groups: lines sharing a key are alternatives (customer picks one).
    optionGroupKey: z.string().trim().min(1).max(80).optional(),
    optionGroupLabel: z.string().trim().min(1).max(160).optional(),
  })
  .refine((data) => Boolean(data.optionGroupKey) === Boolean(data.optionGroupLabel), {
    message: "optionGroupKey and optionGroupLabel must be provided together",
  });

export async function GET(
  _request: Request,
  context: { params: Promise<{ revisionId: string }> },
): Promise<Response> {
  try {
    const tenantContext = await getRequestContext();
    const { revisionId } = await context.params;
    const lines = await db.estimateLine.findMany({
      where: { estimateRevisionId: revisionId, organizationId: tenantContext.organizationId },
      orderBy: { position: "asc" },
      select: {
        id: true,
        kind: true,
        description: true,
        quantityMilli: true,
        unitPriceMinor: true,
        discountMinor: true,
        taxable: true,
        taxRateBasisPoints: true,
        taxMinor: true,
        totalMinor: true,
        position: true,
        optionGroupKey: true,
        optionGroupLabel: true,
      },
    });
    return Response.json(
      {
        lines: lines.map((line) => ({
          ...line,
          unitPriceMinor: line.unitPriceMinor.toString(),
          discountMinor: line.discountMinor.toString(),
          taxMinor: line.taxMinor.toString(),
          totalMinor: line.totalMinor.toString(),
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return mapTenantError(error);
  }
}

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
      ...(parsed.data.taxRateId ? { taxRateId: parsed.data.taxRateId } : {}),
      position: parsed.data.position,
      ...(parsed.data.optionGroupKey ? { optionGroupKey: parsed.data.optionGroupKey } : {}),
      ...(parsed.data.optionGroupLabel ? { optionGroupLabel: parsed.data.optionGroupLabel } : {}),
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
