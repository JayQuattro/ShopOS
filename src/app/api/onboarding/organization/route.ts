import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/db/client";
import { auth } from "@/modules/identity/auth";
import { hasTrustedMutationOrigin } from "@/modules/identity/request-origin";
import { getCurrentSession } from "@/modules/identity/session";
import {
  provisionOrganization,
  ProvisionOrganizationFailed,
} from "@/modules/organizations/provision-organization";

const onboardingSchema = z.object({
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

export async function POST(request: Request): Promise<Response> {
  if (!hasTrustedMutationOrigin(request)) {
    return NextResponse.json({ error: "untrusted_origin" }, { status: 403 });
  }

  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey) {
    return NextResponse.json({ error: "idempotency_key_required" }, { status: 400 });
  }

  const parsed = onboardingSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  try {
    const result = await provisionOrganization({
      db,
      actor: {
        kind: "self-service",
        userId: session.user.id,
        requestId: request.headers.get("x-request-id") ?? crypto.randomUUID(),
      },
      idempotencyKey,
      organization: parsed.data.organization,
      firstLocation: parsed.data.firstLocation,
    });

    await auth.api.setActiveOrganization({
      headers: request.headers,
      body: {
        organizationId: result.organizationId,
      },
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
    throw error;
  }
}
