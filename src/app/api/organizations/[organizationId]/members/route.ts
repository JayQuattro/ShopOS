import { z } from "zod";

import { db } from "@/db/client";
import { MembershipRepository } from "@/modules/memberships/membership-repository";
import { inviteMember, MemberMutationFailed } from "@/modules/memberships/membership-service";
import { InvalidBuiltInRole } from "@/modules/memberships/role-policy";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { mapTenantError } from "@/modules/tenancy/http-errors";

export const dynamic = "force-dynamic";

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  roleKey: z.string().trim().min(1).max(64),
});

export async function GET(
  _request: Request,
  context: { params: Promise<{ organizationId: string }> },
): Promise<Response> {
  try {
    const tenantContext = await getRequestContext();
    const { organizationId } = await context.params;
    if (tenantContext.organizationId !== organizationId) {
      return Response.json({ error: "organization_denied" }, { status: 403 });
    }
    const repo = new MembershipRepository({ db, context: tenantContext });
    const members = await repo.listMemberships();
    return Response.json({ members }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapTenantError(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ organizationId: string }> },
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  const parsed = inviteSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const tenantContext = await getRequestContext();
    const { organizationId } = await context.params;
    if (tenantContext.organizationId !== organizationId) {
      return Response.json({ error: "organization_denied" }, { status: 403 });
    }
    const result = await inviteMember({
      db,
      context: tenantContext,
      email: parsed.data.email,
      roleKey: parsed.data.roleKey,
    });
    return Response.json(
      { invitationId: result.invitationId, expiresAt: result.expiresAt },
      {
        status: 201,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    if (error instanceof InvalidBuiltInRole) {
      return Response.json({ error: "invalid_role" }, { status: 400 });
    }
    if (error instanceof MemberMutationFailed) {
      return Response.json({ error: error.reason }, { status: 409 });
    }
    return mapTenantError(error);
  }
}
