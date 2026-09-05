import { z } from "zod";

import { db } from "@/db/client";
import { hasTrustedMutationOrigin } from "@/modules/identity/request-origin";
import {
  OrgConnectorOperationFailed,
  sendOrgEmailTestMessage,
} from "@/modules/integrations/org-connectors";
import { mapTenantError } from "@/modules/tenancy/http-errors";
import { getRequestContext } from "@/modules/tenancy/request-context";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  to: z
    .string()
    .trim()
    .min(3)
    .max(254)
    .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "must be an email address"),
});

/** Sends one real test message through this organization's effective provider. */
export async function POST(
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

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_recipient" }, { status: 422 });
  }

  try {
    const { organizationId } = await context.params;
    const tenantContext = await getRequestContext(organizationId);
    if (tenantContext.organizationId !== organizationId) {
      return Response.json({ error: "organization_denied" }, { status: 403 });
    }

    const result = await sendOrgEmailTestMessage({
      db,
      context: tenantContext,
      to: parsed.data.to,
    });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof OrgConnectorOperationFailed) {
      const statusMap: Record<string, number> = {
        invalid_recipient: 422,
        email_not_configured: 503,
        send_failed: 502,
      };
      return Response.json({ error: error.reason }, { status: statusMap[error.reason] ?? 400 });
    }
    return mapTenantError(error);
  }
}
