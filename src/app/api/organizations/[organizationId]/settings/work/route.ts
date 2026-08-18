import { z } from "zod";

import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";
import {
  WorkPreferencesFailed,
  getWorkPreferences,
  updateWorkPreferences,
} from "@/modules/estimates/work-preferences-service";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ organizationId: string }> },
): Promise<Response> {
  try {
    const { organizationId } = await context.params;
    const tenantContext = await getRequestContext(organizationId);
    if (tenantContext.organizationId !== organizationId) {
      return Response.json({ error: "organization_denied" }, { status: 403 });
    }
    const preferences = await getWorkPreferences(db, tenantContext);
    return Response.json(preferences, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof WorkPreferencesFailed) {
      return Response.json({ error: error.reason }, { status: 400 });
    }
    return mapTenantError(error);
  }
}

const updateSchema = z.object({
  changeOrderCreditPolicy: z.enum(["AUTO_APPLY", "REQUIRE_APPROVAL"]),
  invoiceLinePolicy: z.enum(["APPROVED_ONLY", "ALL_LINES"]),
  defaultPaperSize: z.enum(["LETTER", "A4", "LEGAL"]),
  qualityCheckRequired: z.boolean(),
  authorizationLinkTtlHours: z.number().int().min(1).max(720),
  workOrderNumberPrefix: z.string().trim().min(1).max(12),
  invoiceNumberPrefix: z.string().trim().min(1).max(12),
  defaultLaborRateMinor: z.number().int().min(0),
  defaultTaxRateBasisPoints: z.number().int().min(0).max(10000),
});

export async function PUT(
  request: Request,
  context: { params: Promise<{ organizationId: string }> },
): Promise<Response> {
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
    const { organizationId } = await context.params;
    const tenantContext = await getRequestContext(organizationId);
    if (tenantContext.organizationId !== organizationId) {
      return Response.json({ error: "organization_denied" }, { status: 403 });
    }
    await updateWorkPreferences(db, tenantContext, parsed.data);
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof WorkPreferencesFailed) {
      return Response.json({ error: error.reason }, { status: 400 });
    }
    return mapTenantError(error);
  }
}
