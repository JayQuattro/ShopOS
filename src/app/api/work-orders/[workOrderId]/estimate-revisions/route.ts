import { z } from "zod";

import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { createDraftRevision, EstimateFailed } from "@/modules/estimates/estimate-service";

export const dynamic = "force-dynamic";

const createSchema = z.object({ currency: z.string().regex(/^[A-Z]{3}$/) });

export async function GET(
  _request: Request,
  context: { params: Promise<{ workOrderId: string }> },
): Promise<Response> {
  try {
    const tenantContext = await getRequestContext();
    const { workOrderId } = await context.params;
    const revisions = await db.estimateRevision.findMany({
      where: { workOrderId, organizationId: tenantContext.organizationId },
      orderBy: { revisionNumber: "desc" },
      select: {
        id: true,
        revisionNumber: true,
        status: true,
        currency: true,
        subtotalMinor: true,
        discountMinor: true,
        taxMinor: true,
        totalMinor: true,
        presentedAt: true,
        createdAt: true,
      },
    });
    return Response.json(
      {
        revisions: revisions.map((r) => ({
          ...r,
          subtotalMinor: r.subtotalMinor.toString(),
          discountMinor: r.discountMinor.toString(),
          taxMinor: r.taxMinor.toString(),
          totalMinor: r.totalMinor.toString(),
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
  context: { params: Promise<{ workOrderId: string }> },
): Promise<Response> {
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
    const { workOrderId } = await context.params;
    const result = await createDraftRevision({
      db,
      context: tenantContext,
      workOrderId,
      currency: parsed.data.currency,
    });
    return Response.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof EstimateFailed) {
      return Response.json({ error: error.reason }, { status: 400 });
    }
    return mapTenantError(error);
  }
}
