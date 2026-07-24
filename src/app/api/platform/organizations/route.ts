import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/db/client";
import { hasTrustedMutationOrigin } from "@/modules/identity/request-origin";
import {
  provisionOrganization,
  ProvisionOrganizationFailed,
} from "@/modules/organizations/provision-organization";
import {
  PlatformContextNotResolved,
  PlatformPermissionDenied,
} from "@/modules/platform/authorization";
import { listPlatformOrganizations } from "@/modules/platform/organizations";
import { getPlatformRequestContext } from "@/modules/platform/request-context";

const platformProvisioningSchema = z.object({
  foundingUserId: z.string().uuid(),
  organization: z.object({
    name: z.string().min(2).max(180),
    slug: z.string().min(2).max(80),
    defaultCurrency: z.string().length(3).default("USD"),
  }),
  firstLocation: z.object({
    name: z.string().min(2).max(180),
    code: z.string().min(1).max(32),
    timeZone: z.string().min(1).max(80),
  }),
});

export async function GET(): Promise<Response> {
  try {
    const context = await getPlatformRequestContext();
    const organizations = await listPlatformOrganizations(db, context);
    return NextResponse.json({ organizations });
  } catch (error) {
    return platformErrorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!hasTrustedMutationOrigin(request)) {
    return NextResponse.json({ error: "untrusted_origin" }, { status: 403 });
  }

  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey) {
    return NextResponse.json({ error: "idempotency_key_required" }, { status: 400 });
  }

  const parsed = platformProvisioningSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  try {
    const context = await getPlatformRequestContext();
    const result = await provisionOrganization({
      db,
      actor: {
        kind: "platform",
        context,
        foundingUserId: parsed.data.foundingUserId,
      },
      idempotencyKey,
      organization: parsed.data.organization,
      firstLocation: parsed.data.firstLocation,
    });
    return NextResponse.json(result, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    if (error instanceof ProvisionOrganizationFailed) {
      const status =
        error.reason === "invalid_input" || error.reason === "founding_user_not_eligible"
          ? 400
          : 409;
      return NextResponse.json({ error: error.reason }, { status });
    }
    return platformErrorResponse(error);
  }
}

function platformErrorResponse(error: unknown): Response {
  if (error instanceof PlatformContextNotResolved) {
    return NextResponse.json({ error: "platform_access_unavailable" }, { status: 404 });
  }
  if (error instanceof PlatformPermissionDenied) {
    return NextResponse.json({ error: "platform_permission_denied" }, { status: 403 });
  }
  throw error;
}
