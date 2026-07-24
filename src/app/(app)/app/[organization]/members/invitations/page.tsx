import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/db/client";
import { MembershipRepository } from "@/modules/memberships/membership-repository";
import { membershipStrings } from "@/modules/memberships/ui/strings";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { CancelInvitationButton } from "./cancel-invitation-button";

export default async function InvitationsPage({
  params,
}: {
  params: Promise<{ organization: string }>;
}) {
  const context = await getRequestContext();
  const { organization } = await params;
  if (context.organizationId !== organization) {
    return <p className="text-destructive">{membershipStrings.errors.unauthorized}</p>;
  }

  const repo = new MembershipRepository({ db, context });
  const invitations = await repo.listInvitations();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{membershipStrings.invitations}</CardTitle>
        <CardDescription>Pending and past invitations for this organization.</CardDescription>
      </CardHeader>
      <CardContent>
        {invitations.length === 0 ? (
          <p className="text-sm text-muted-foreground">No invitations.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">{membershipStrings.email}</th>
                <th className="py-2 pr-4 font-medium">{membershipStrings.inviteRoleLabel}</th>
                <th className="py-2 pr-4 font-medium">{membershipStrings.status}</th>
                <th className="py-2 pr-4 font-medium">{membershipStrings.actions}</th>
              </tr>
            </thead>
            <tbody>
              {invitations.map((invitation) => (
                <tr key={invitation.id} className="border-b border-border/60">
                  <td className="py-3 pr-4">{invitation.email}</td>
                  <td className="py-3 pr-4 capitalize text-muted-foreground">
                    {invitation.role ?? "—"}
                  </td>
                  <td className="py-3 pr-4 capitalize">{invitation.status}</td>
                  <td className="py-3 pr-4">
                    {invitation.status === "pending" ? (
                      <CancelInvitationButton
                        organizationId={context.organizationId}
                        invitationId={invitation.id}
                      />
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
