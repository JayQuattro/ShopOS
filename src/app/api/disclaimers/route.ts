import { z } from "zod";

import { db } from "@/db/client";
import {
  createTemplate,
  DisclaimerFailed,
  listTemplates,
  updateTemplate,
} from "@/modules/invoices/disclaimer-service";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().trim().min(2).max(120),
  body: z.string().trim().min(2).max(2000),
  triggerKey: z.enum(["CUSTOMER_PARTS", "SUBLET"]).optional(),
});

const updateSchema = z.object({
  templateId: z.string().min(1),
  name: z.string().trim().min(2).max(120).optional(),
  body: z.string().trim().min(2).max(2000).optional(),
  triggerKey: z.enum(["CUSTOMER_PARTS", "SUBLET"]).nullable().optional(),
  active: z.boolean().optional(),
});

export async function GET(): Promise<Response> {
  try {
    const tenantContext = await getRequestContext();
    const templates = await listTemplates({ db, context: tenantContext });
    return Response.json({ templates }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapTenantError(error);
  }
}

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
    const result = await createTemplate({
      db,
      context: tenantContext,
      name: parsed.data.name,
      body: parsed.data.body,
      ...(parsed.data.triggerKey ? { triggerKey: parsed.data.triggerKey } : {}),
    });
    return Response.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return disclaimerError(error);
  }
}

export async function PUT(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }
  try {
    const tenantContext = await getRequestContext();
    await updateTemplate({
      db,
      context: tenantContext,
      templateId: parsed.data.templateId,
      ...(parsed.data.name ? { name: parsed.data.name } : {}),
      ...(parsed.data.body ? { body: parsed.data.body } : {}),
      ...(parsed.data.triggerKey !== undefined ? { triggerKey: parsed.data.triggerKey } : {}),
      ...(parsed.data.active !== undefined ? { active: parsed.data.active } : {}),
    });
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return disclaimerError(error);
  }
}

function disclaimerError(error: unknown): Response {
  if (error instanceof DisclaimerFailed) {
    const statusMap: Record<string, number> = {
      template_not_found: 404,
      duplicate_name: 409,
      invalid_name: 400,
      invalid_body: 400,
      invoice_not_found: 404,
      invoice_not_draft: 409,
      disclaimer_not_found: 404,
    };
    return Response.json({ error: error.reason }, { status: statusMap[error.reason] ?? 400 });
  }
  return mapTenantError(error);
}
