import { z } from "zod";

import { db } from "@/db/client";
import { hasTrustedMutationOrigin } from "@/modules/identity/request-origin";
import {
  PlatformContextNotResolved,
  PlatformPermissionDenied,
} from "@/modules/platform/authorization";
import { extendOperatorGrant, OperatorGrantFailed } from "@/modules/platform/operator-grants";
import { getPlatformRequestContext } from "@/modules/platform/request-context";

export const dynamic = "force-dynamic";

const extendSchema = z.object({
  newExpiresAt: z.string().datetime().nullable(),
  reason: z.string().trim().min(10).max(500),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ grantId: string }> },
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

  const parsed = extendSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }

  const { grantId } = await context.params;

  try {
    const platformContext = await getPlatformRequestContext();
    await extendOperatorGrant({
      db,
      context: platformContext,
      grantId,
      newExpiresAt: parsed.data.newExpiresAt ? new Date(parsed.data.newExpiresAt) : null,
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
    if (error instanceof OperatorGrantFailed) {
      const status = error.reason === "grant_not_found" ? 404 : 409;
      return Response.json({ error: error.reason }, { status });
    }
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}
