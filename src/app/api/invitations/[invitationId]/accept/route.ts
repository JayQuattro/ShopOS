import { z } from "zod";

import { db } from "@/db/client";
import {
  acceptInvitation,
  InvitationAcceptanceFailed,
} from "@/modules/memberships/membership-service";
import { TenantContextNotResolved } from "@/modules/tenancy/resolve-tenant-context";

export const dynamic = "force-dynamic";

/**
 * Accepts an organization invitation using the authenticated user's own
 * session. This route deliberately does NOT require a TenantContext for the
 * target org: the acceptor may have no membership there yet. Identity and email
 * ownership are verified inside `acceptInvitation` from the session, never from
 * request input.
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ invitationId: string }> },
): Promise<Response> {
  const invitationSchema = z.object({ invitationId: z.string().min(1) });
  const { invitationId } = await context.params;
  const parsed = invitationSchema.safeParse({ invitationId });
  if (!parsed.success) {
    return Response.json({ error: "invalid_invitation" }, { status: 400 });
  }

  try {
    const result = await acceptInvitation({ db, invitationId: parsed.data.invitationId });
    return Response.json(
      { organizationId: result.organizationId, membershipId: result.membershipId },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof InvitationAcceptanceFailed) {
      // Map email/unverified and not-found to the same status to avoid leaking
      // whether an invitation exists for a given address.
      const status =
        error.reason === "email_mismatch" || error.reason === "email_unverified"
          ? 403
          : error.reason === "not_found"
            ? 404
            : 409;
      return Response.json({ error: error.reason }, { status });
    }
    if (error instanceof TenantContextNotResolved) {
      return Response.json({ error: error.reason }, { status: 401 });
    }
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}
