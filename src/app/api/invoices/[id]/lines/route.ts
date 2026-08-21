import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";

export const dynamic = "force-dynamic";

/**
 * Invoice lines with their job grouping (from the source estimate line) and
 * warranty terms — powers the per-job warranty editor.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  try {
    const tenantContext = await getRequestContext();
    const lines = await db.invoiceLine.findMany({
      where: { invoiceId: id, organizationId: tenantContext.organizationId },
      orderBy: { position: "asc" },
      select: {
        id: true,
        description: true,
        kind: true,
        warrantyMonths: true,
        warrantyMiles: true,
        sourceEstimateLine: {
          select: { serviceGroupKey: true, serviceGroupLabel: true },
        },
      },
    });
    return Response.json(
      {
        lines: lines.map((line) => ({
          id: line.id,
          description: line.description,
          kind: line.kind,
          warrantyMonths: line.warrantyMonths,
          warrantyMiles: line.warrantyMiles,
          groupKey: line.sourceEstimateLine?.serviceGroupKey ?? null,
          groupLabel:
            line.sourceEstimateLine?.serviceGroupLabel ??
            (line.sourceEstimateLine && line.sourceEstimateLine.serviceGroupKey !== "general"
              ? line.sourceEstimateLine.serviceGroupKey
              : null),
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return mapTenantError(error);
  }
}
