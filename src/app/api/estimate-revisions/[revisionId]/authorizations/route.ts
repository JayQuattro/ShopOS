import { z } from "zod";

import { db } from "@/db/client";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";
import {
  AuthorizationFailed,
  getAuthorizationState,
  recordAuthorization,
} from "@/modules/estimates/authorization-service";

export const dynamic = "force-dynamic";

const recordSchema = z.object({
  method: z.enum(["CUSTOMER_LINK", "PHONE", "IN_PERSON", "EMAIL", "OTHER"]),
  providedByName: z.string().trim().min(1).max(180),
  note: z.string().max(2000).optional(),
  decisions: z
    .array(
      z.object({
        estimateLineId: z.string().uuid(),
        decision: z.enum(["APPROVED", "DECLINED"]),
      }),
    )
    .min(1),
});

export async function GET(
  _request: Request,
  context: { params: Promise<{ revisionId: string }> },
): Promise<Response> {
  try {
    const tenantContext = await getRequestContext();
    const { revisionId } = await context.params;
    const state = await getAuthorizationState({ db, context: tenantContext, revisionId });
    return Response.json({ state }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthorizationFailed) {
      return Response.json({ error: error.reason }, { status: 404 });
    }
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

  const parsed = recordSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const tenantContext = await getRequestContext();
    const { revisionId } = await context.params;
    const result = await recordAuthorization({
      db,
      context: tenantContext,
      revisionId,
      method: parsed.data.method,
      providedByName: parsed.data.providedByName,
      ...(parsed.data.note ? { note: parsed.data.note } : {}),
      decisions: parsed.data.decisions,
    });
    return Response.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthorizationFailed) {
      const status =
        error.reason === "revision_not_found" || error.reason === "line_not_found" ? 404 : 409;
      return Response.json({ error: error.reason }, { status });
    }
    return mapTenantError(error);
  }
}
