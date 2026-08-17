import { z } from "zod";

import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";
import {
  createServiceTemplate,
  deleteServiceTemplate,
  listServiceTemplates,
  ServiceTemplateFailed,
} from "@/modules/work-orders/service-template-service";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const tenantContext = await getRequestContext();
    const templates = await listServiceTemplates({ db, context: tenantContext });
    return Response.json({ templates }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapTenantError(error);
  }
}

const createSchema = z.object({
  name: z.string().trim().min(2).max(180),
  notes: z.string().trim().max(2000).optional(),
  lines: z
    .array(
      z.object({
        kind: z.enum(["LABOR", "PART", "FEE"]),
        serviceGroupKey: z.string().trim().min(1).max(80),
        description: z.string().trim().min(2).max(300),
        quantityMilli: z.number().int().min(1),
        unitPriceMinor: z.number().int().min(0),
        taxable: z.boolean(),
        taxRateBasisPoints: z.number().int().min(0),
      }),
    )
    .default([]),
  tasks: z.array(z.object({ title: z.string().trim().min(3).max(200) })).default([]),
});

export async function POST(request: Request): Promise<Response> {
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
    const result = await createServiceTemplate({
      db,
      context: tenantContext,
      name: parsed.data.name,
      ...(parsed.data.notes ? { notes: parsed.data.notes } : {}),
      lines: parsed.data.lines,
      tasks: parsed.data.tasks,
    });
    return Response.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ServiceTemplateFailed) {
      const status = error.reason === "template_not_found" ? 404 : 400;
      return Response.json({ error: error.reason }, { status });
    }
    return mapTenantError(error);
  }
}

export async function DELETE(request: Request): Promise<Response> {
  const templateId = new URL(request.url).searchParams.get("templateId");
  if (!templateId) return Response.json({ error: "missing_templateId" }, { status: 400 });

  try {
    const tenantContext = await getRequestContext();
    await deleteServiceTemplate({ db, context: tenantContext, templateId });
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ServiceTemplateFailed) {
      const status = error.reason === "template_not_found" ? 404 : 400;
      return Response.json({ error: error.reason }, { status });
    }
    return mapTenantError(error);
  }
}
