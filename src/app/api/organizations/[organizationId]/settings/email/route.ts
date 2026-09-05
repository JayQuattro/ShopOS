import { z } from "zod";

import { db } from "@/db/client";
import { hasTrustedMutationOrigin } from "@/modules/identity/request-origin";
import { OrgConnectorOperationFailed } from "@/modules/integrations/org-connectors";
import {
  deleteOrgEmailConnector,
  getOrgEmailConnector,
  upsertOrgEmailConnector,
} from "@/modules/integrations/org-connectors";
import { EMAIL_ADAPTER_DEFINITIONS } from "@/modules/integrations/email/adapters/adapter-types";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";

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
    const connector = await getOrgEmailConnector(db, tenantContext);
    return Response.json(
      { connector, adapters: EMAIL_ADAPTER_DEFINITIONS },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return orgConnectorError(error);
  }
}

const upsertSchema = z.object({
  adapterKey: z.string().min(1).max(64),
  displayName: z.string().trim().min(1).max(180),
  configuration: z.record(z.string(), z.unknown()),
  secret: z.record(z.string(), z.string()),
});

export async function PUT(
  request: Request,
  context: { params: Promise<{ organizationId: string }> },
): Promise<Response> {
  if (!hasTrustedMutationOrigin(request)) {
    return Response.json({ error: "untrusted_origin" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const { organizationId } = await context.params;
    const tenantContext = await getRequestContext(organizationId);
    if (tenantContext.organizationId !== organizationId) {
      return Response.json({ error: "organization_denied" }, { status: 403 });
    }

    const result = await upsertOrgEmailConnector({
      db,
      context: tenantContext,
      adapterKey: parsed.data.adapterKey,
      displayName: parsed.data.displayName,
      configuration: parsed.data.configuration,
      secret: parsed.data.secret,
    });
    return Response.json(result, {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return orgConnectorError(error);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ organizationId: string }> },
): Promise<Response> {
  if (!hasTrustedMutationOrigin(request)) {
    return Response.json({ error: "untrusted_origin" }, { status: 403 });
  }

  try {
    const { organizationId } = await context.params;
    const tenantContext = await getRequestContext(organizationId);
    if (tenantContext.organizationId !== organizationId) {
      return Response.json({ error: "organization_denied" }, { status: 403 });
    }

    await deleteOrgEmailConnector({ db, context: tenantContext });
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return orgConnectorError(error);
  }
}

function orgConnectorError(error: unknown): Response {
  if (error instanceof OrgConnectorOperationFailed) {
    const status = error.reason === "connector_not_found" ? 404 : 400;
    return Response.json({ error: error.reason }, { status });
  }
  return mapTenantError(error);
}
