import { z } from "zod";

import { db } from "@/db/client";
import { hasTrustedMutationOrigin } from "@/modules/identity/request-origin";
import {
  PlatformContextNotResolved,
  PlatformPermissionDenied,
} from "@/modules/platform/authorization";
import {
  EntitlementOperationFailed,
  transitionSubscriptionState,
} from "@/modules/platform/entitlements";
import { getPlatformRequestContext } from "@/modules/platform/request-context";

export const dynamic = "force-dynamic";

const transitionSchema = z.object({
  newState: z.enum(["UNMANAGED", "TRIALING", "ACTIVE", "PAST_DUE", "CANCELED"]),
  reason: z.string().trim().min(10).max(500),
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

  const parsed = transitionSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const platformContext = await getPlatformRequestContext();
    const { organizationId } = await context.params;
    await transitionSubscriptionState({
      db,
      context: platformContext,
      organizationId,
      newState: parsed.data.newState,
      reason: parsed.data.reason,
    });
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
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
}
