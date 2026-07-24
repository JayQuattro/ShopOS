import { z } from "zod";

import { db } from "@/db/client";
import { hasTrustedMutationOrigin } from "@/modules/identity/request-origin";
import {
  PlatformContextNotResolved,
  PlatformPermissionDenied,
} from "@/modules/platform/authorization";
import { grantOperatorRole, OperatorGrantFailed } from "@/modules/platform/operator-grants";
import { getPlatformRequestContext } from "@/modules/platform/request-context";

export const dynamic = "force-dynamic";

const grantSchema = z.object({
  targetUserId: z.string().uuid(),
  role: z.enum(["VIEWER", "OPERATOR", "ADMIN"]),
  reason: z.string().trim().min(10).max(500),
  expiresAt: z.string().datetime().optional(),
});

export async function POST(request: Request): Promise<Response> {
  if (!hasTrustedMutationOrigin(request)) {
    return Response.json({ error: "untrusted_origin" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  const parsed = grantSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const context = await getPlatformRequestContext();
    const result = await grantOperatorRole({
      db,
      context,
      targetUserId: parsed.data.targetUserId,
      role: parsed.data.role,
      reason: parsed.data.reason,
      ...(parsed.data.expiresAt ? { expiresAt: new Date(parsed.data.expiresAt) } : {}),
    });
    return Response.json(
      { grantId: result.grantId },
      {
        status: 201,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    if (error instanceof PlatformContextNotResolved) {
      return Response.json({ error: "platform_access_unavailable" }, { status: 404 });
    }
    if (error instanceof PlatformPermissionDenied) {
      return Response.json({ error: "platform_permission_denied" }, { status: 403 });
    }
    if (error instanceof OperatorGrantFailed) {
      return Response.json({ error: error.reason }, { status: 409 });
    }
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}
