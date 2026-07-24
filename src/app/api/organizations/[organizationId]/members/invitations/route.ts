import { db } from "@/db/client";
import { MembershipRepository } from "@/modules/memberships/membership-repository";
import { cancelInvitation, MemberMutationFailed } from "@/modules/memberships/membership-service";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { mapTenantError } from "@/modules/tenancy/http-errors";

export const dynamic = "force-dynamic";

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
    const invitations = await repo.listInvitations();
    return Response.json({ invitations }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapTenantError(error);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ organizationId: string }> },
): Promise<Response> {
  const url = new URL(request.url);
  const invitationId = url.searchParams.get("invitationId");
  if (!invitationId) {
    return Response.json({ error: "missing_invitationId" }, { status: 400 });
  }

  try {
    const tenantContext = await getRequestContext();
    const { organizationId } = await context.params;
    if (tenantContext.organizationId !== organizationId) {
      return Response.json({ error: "organization_denied" }, { status: 403 });
    }
    await cancelInvitation({ db, context: tenantContext, invitationId });
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof MemberMutationFailed) {
      return Response.json({ error: error.reason }, { status: 404 });
    }
    return mapTenantError(error);
  }
}
