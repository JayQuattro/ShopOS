import { z } from "zod";

import { db } from "@/db/client";
import {
  assignRole,
  MemberMutationFailed,
  revokeRole,
} from "@/modules/memberships/membership-service";
import {
  InvalidBuiltInRole,
  LastOwnerProtected,
  RoleEscalationDenied,
} from "@/modules/memberships/role-policy";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { mapTenantError } from "@/modules/tenancy/http-errors";

export const dynamic = "force-dynamic";

const roleSchema = z.object({ roleKey: z.string().trim().min(1).max(64) });

export async function POST(
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

  const parsed = roleSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const tenantContext = await getRequestContext();
    const { organizationId, membershipId } = await context.params;
    if (tenantContext.organizationId !== organizationId) {
      return Response.json({ error: "organization_denied" }, { status: 403 });
    }
    await assignRole({
      db,
      context: tenantContext,
      membershipId,
      roleKey: parsed.data.roleKey,
    });
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof InvalidBuiltInRole) {
      return Response.json({ error: "invalid_role" }, { status: 400 });
    }
    if (error instanceof RoleEscalationDenied) {
      return Response.json({ error: "role_escalation_denied" }, { status: 403 });
    }
    if (error instanceof MemberMutationFailed) {
      return Response.json({ error: error.reason }, { status: 404 });
    }
    return mapTenantError(error);
  }
}

export async function DELETE(
  request: Request,
  context: {
    params: Promise<{ organizationId: string; membershipId: string }>;
  },
): Promise<Response> {
  const url = new URL(request.url);
  const roleKey = url.searchParams.get("roleKey");
  if (!roleKey) {
    return Response.json({ error: "missing_roleKey" }, { status: 400 });
  }

  try {
    const tenantContext = await getRequestContext();
    const { organizationId, membershipId } = await context.params;
    if (tenantContext.organizationId !== organizationId) {
      return Response.json({ error: "organization_denied" }, { status: 403 });
    }
    await revokeRole({ db, context: tenantContext, membershipId, roleKey });
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof InvalidBuiltInRole) {
      return Response.json({ error: "invalid_role" }, { status: 400 });
    }
    if (error instanceof LastOwnerProtected) {
      return Response.json({ error: "last_owner_protected" }, { status: 409 });
    }
    if (error instanceof MemberMutationFailed) {
      return Response.json({ error: error.reason }, { status: 404 });
    }
    return mapTenantError(error);
  }
}
