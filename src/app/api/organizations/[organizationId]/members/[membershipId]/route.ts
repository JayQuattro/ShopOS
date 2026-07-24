import { z } from "zod";

import { db } from "@/db/client";
import {
  deactivateMembership,
  MemberMutationFailed,
  reactivateMembership,
} from "@/modules/memberships/membership-service";
import { LastOwnerProtected } from "@/modules/memberships/role-policy";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { mapTenantError } from "@/modules/tenancy/http-errors";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  active: z.boolean(),
});

export async function PATCH(
  request: Request,
  context: {
    params: Promise<{ organizationId: string; membershipId: string }>;
  },
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const tenantContext = await getRequestContext();
    const { organizationId, membershipId } = await context.params;
    if (tenantContext.organizationId !== organizationId) {
      return Response.json({ error: "organization_denied" }, { status: 403 });
    }

    if (parsed.data.active) {
      await reactivateMembership({ db, context: tenantContext, membershipId });
    } else {
      await deactivateMembership({ db, context: tenantContext, membershipId });
    }
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof LastOwnerProtected) {
      return Response.json({ error: "last_owner_protected" }, { status: 409 });
    }
    if (error instanceof MemberMutationFailed) {
      return Response.json({ error: error.reason }, { status: 404 });
    }
    return mapTenantError(error);
  }
}
