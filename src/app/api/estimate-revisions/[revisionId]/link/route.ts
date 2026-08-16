import { z } from "zod";

import { db } from "@/db/client";
import {
  AuthorizationLinkFailed,
  createAuthorizationLink,
  revokeAuthorizationLink,
} from "@/modules/estimates/authorization-link-service";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  expiresInHours: z.number().int().min(1).max(168).optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ revisionId: string }> },
): Promise<Response> {
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    // Body is optional for defaults.
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const tenantContext = await getRequestContext();
    const { revisionId } = await context.params;
    const result = await createAuthorizationLink({
      db,
      context: tenantContext,
      revisionId,
      ...(parsed.data.expiresInHours !== undefined
        ? { expiresInHours: parsed.data.expiresInHours }
        : {}),
    });
    return Response.json(result, {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof AuthorizationLinkFailed) {
      return Response.json({ error: error.reason }, { status: 400 });
    }
    return mapTenantError(error);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ revisionId: string }> },
): Promise<Response> {
  try {
    const tenantContext = await getRequestContext();
    const { revisionId } = await context.params;

    // Find the active link for this revision and revoke it.
    const link = await db.authorizationLink.findFirst({
      where: {
        organizationId: tenantContext.organizationId,
        estimateRevisionId: revisionId,
        revokedAt: null,
      },
      select: { id: true },
    });
    if (!link) {
      return Response.json({ error: "link_not_found" }, { status: 404 });
    }

    await revokeAuthorizationLink({
      db,
      context: tenantContext,
      linkId: link.id,
    });
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthorizationLinkFailed) {
      return Response.json({ error: error.reason }, { status: 404 });
    }
    return mapTenantError(error);
  }
}
