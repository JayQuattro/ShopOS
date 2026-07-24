import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/db/client";
import { hasTrustedMutationOrigin } from "@/modules/identity/request-origin";
import {
  PlatformContextNotResolved,
  PlatformPermissionDenied,
} from "@/modules/platform/authorization";
import {
  changeOrganizationStatus,
  ChangeOrganizationStatusFailed,
} from "@/modules/platform/organizations";
import { getPlatformRequestContext } from "@/modules/platform/request-context";

const statusSchema = z.object({
  status: z.enum(["ACTIVE", "SUSPENDED"]),
  reason: z.string().min(10).max(500),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ organizationId: string }> },
): Promise<Response> {
  if (!hasTrustedMutationOrigin(request)) {
    return NextResponse.json({ error: "untrusted_origin" }, { status: 403 });
  }

  const parsed = statusSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  try {
    const platformContext = await getPlatformRequestContext();
    const { organizationId } = await context.params;
    const result = await changeOrganizationStatus({
      db,
      context: platformContext,
      organizationId,
      targetStatus: parsed.data.status,
      reason: parsed.data.reason,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof PlatformContextNotResolved) {
      return NextResponse.json({ error: "platform_access_unavailable" }, { status: 404 });
    }
    if (error instanceof PlatformPermissionDenied) {
      return NextResponse.json({ error: "platform_permission_denied" }, { status: 403 });
    }
    if (error instanceof ChangeOrganizationStatusFailed) {
      const status = error.reason === "organization_not_found" ? 404 : 409;
      return NextResponse.json({ error: error.reason }, { status });
    }
    throw error;
  }
}
