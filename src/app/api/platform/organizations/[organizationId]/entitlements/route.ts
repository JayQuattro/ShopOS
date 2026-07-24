import { z } from "zod";

import { db } from "@/db/client";
import { hasTrustedMutationOrigin } from "@/modules/identity/request-origin";
import {
  PlatformContextNotResolved,
  PlatformPermissionDenied,
} from "@/modules/platform/authorization";
import {
  EntitlementOperationFailed,
  listEntitlements,
  setEntitlement,
} from "@/modules/platform/entitlements";
import { getPlatformRequestContext } from "@/modules/platform/request-context";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ organizationId: string }> },
): Promise<Response> {
  try {
    const platformContext = await getPlatformRequestContext();
    const { organizationId } = await context.params;
    const entitlements = await listEntitlements(db, platformContext, organizationId);
    return Response.json({ entitlements }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return platformErrorResponse(error);
  }
}

const setSchema = z.object({
  key: z.string().min(1).max(120),
  enabled: z.boolean().optional(),
  limitValue: z.string().nullable().optional(),
  reason: z.string().trim().min(10).max(500),
  expiresAt: z.string().datetime().nullable().optional(),
});

export async function PATCH(
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

  const parsed = setSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const platformContext = await getPlatformRequestContext();
    const { organizationId } = await context.params;
    await setEntitlement({
      db,
      context: platformContext,
      organizationId,
      key: parsed.data.key,
      ...(parsed.data.enabled !== undefined ? { enabled: parsed.data.enabled } : {}),
      ...(parsed.data.limitValue !== undefined
        ? { limitValue: parsed.data.limitValue ? BigInt(parsed.data.limitValue) : null }
        : {}),
      reason: parsed.data.reason,
      ...(parsed.data.expiresAt !== undefined
        ? { expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null }
        : {}),
    });
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return platformErrorResponse(error);
  }
}

function platformErrorResponse(error: unknown): Response {
  if (error instanceof PlatformContextNotResolved) {
    return Response.json({ error: "platform_access_unavailable" }, { status: 404 });
  }
  if (error instanceof PlatformPermissionDenied) {
    return Response.json({ error: "platform_permission_denied" }, { status: 403 });
  }
  if (error instanceof EntitlementOperationFailed) {
    const status =
      error.reason === "organization_not_found"
        ? 404
        : error.reason === "concurrent_change"
          ? 409
          : 400;
    return Response.json({ error: error.reason }, { status });
  }
  return Response.json({ error: "internal_error" }, { status: 500 });
}
