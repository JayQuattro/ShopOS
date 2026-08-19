import { z } from "zod";

import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { createInspection, InspectionFailed } from "@/modules/work-orders/inspection-service";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const tenantContext = await getRequestContext();
    const { id } = await context.params;
    const inspections = await db.inspection.findMany({
      where: { workOrderId: id, organizationId: tenantContext.organizationId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        status: true,
        sharedToken: true,
        completedAt: true,
        items: {
          orderBy: { position: "asc" },
          select: {
            id: true,
            position: true,
            zone: true,
            component: true,
            condition: true,
            note: true,
            recommended: true,
            attachments: { select: { id: true, fileName: true, contentType: true } },
          },
        },
      },
    });
    return Response.json(
      {
        inspections: inspections.map((inspection) => ({
          ...inspection,
          completedAt: inspection.completedAt?.toISOString() ?? null,
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return mapTenantError(error);
  }
}

const bodySchema = z.object({
  title: z.string().trim().min(2).max(180),
  templateId: z.string().uuid().optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
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
    const { id } = await context.params;
    const result = await createInspection({
      db,
      context: tenantContext,
      workOrderId: id,
      title: parsed.data.title,
      ...(parsed.data.templateId ? { templateId: parsed.data.templateId } : {}),
    });
    return Response.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return inspectionError(error);
  }
}

function inspectionError(error: unknown): Response {
  if (error instanceof InspectionFailed) {
    const statusMap: Record<string, number> = {
      work_order_not_found: 404,
      template_not_found: 404,
      inspection_not_found: 404,
      item_not_found: 404,
      not_draft: 409,
      already_shared: 409,
      invalid_condition: 400,
    };
    return Response.json({ error: error.reason }, { status: statusMap[error.reason] ?? 400 });
  }
  return mapTenantError(error);
}
