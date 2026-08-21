import { z } from "zod";

import { db } from "@/db/client";
import {
  applyDisclaimer,
  DisclaimerFailed,
  listApplied,
  removeDisclaimer,
  suggestedForInvoice,
} from "@/modules/invoices/disclaimer-service";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";

export const dynamic = "force-dynamic";

const applySchema = z.object({
  templateId: z.string().min(1).optional(),
  name: z.string().trim().min(2).max(120).optional(),
  body: z.string().trim().min(2).max(2000).optional(),
});

const removeSchema = z.object({ disclaimerId: z.string().min(1) });

export async function GET(
  _request: Request,
  context: { params: Promise<{ invoiceId: string }> },
): Promise<Response> {
  const { invoiceId } = await context.params;
  try {
    const tenantContext = await getRequestContext();
    const [applied, suggestions] = await Promise.all([
      listApplied({ db, context: tenantContext, invoiceId }),
      suggestedForInvoice({ db, context: tenantContext, invoiceId }),
    ]);
    return Response.json({ applied, suggestions }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return disclaimerError(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ invoiceId: string }> },
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }
  const parsed = applySchema.safeParse(body);
  if (!parsed.success || (!parsed.data.templateId && !parsed.data.name)) {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }
  const { invoiceId } = await context.params;
  try {
    const tenantContext = await getRequestContext();
    const result = await applyDisclaimer({
      db,
      context: tenantContext,
      invoiceId,
      ...(parsed.data.templateId ? { templateId: parsed.data.templateId } : {}),
      ...(parsed.data.name ? { name: parsed.data.name } : {}),
      ...(parsed.data.body ? { body: parsed.data.body } : {}),
    });
    return Response.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return disclaimerError(error);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ invoiceId: string }> },
): Promise<Response> {
  const url = new URL(request.url);
  const disclaimerId = url.searchParams.get("disclaimerId");
  if (!disclaimerId) return Response.json({ error: "missing_disclaimerId" }, { status: 400 });
  const parsed = removeSchema.safeParse({ disclaimerId });
  if (!parsed.success) {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }
  const { invoiceId } = await context.params;
  try {
    const tenantContext = await getRequestContext();
    await removeDisclaimer({
      db,
      context: tenantContext,
      invoiceId,
      disclaimerId: parsed.data.disclaimerId,
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
