import Link from "next/link";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/db/client";
import { MembershipRepository } from "@/modules/memberships/membership-repository";
import { membershipStrings } from "@/modules/memberships/ui/strings";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { InviteMemberDialog } from "./invite-member-dialog";

export default async function MembersPage({
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
  const [members] = await Promise.all([repo.listMemberships()]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="grid gap-1.5">
          <CardTitle>{membershipStrings.title}</CardTitle>
          <CardDescription>{membershipStrings.description}</CardDescription>
        </div>
        <InviteMemberDialog organizationId={context.organizationId} />
      </CardHeader>
      <CardContent>
        {members.length === 0 ? (
          <p className="text-sm text-muted-foreground">{membershipStrings.noMembers}</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">{membershipStrings.member}</th>
                <th className="py-2 pr-4 font-medium">{membershipStrings.email}</th>
                <th className="py-2 pr-4 font-medium">{membershipStrings.roles}</th>
                <th className="py-2 pr-4 font-medium">{membershipStrings.status}</th>
                <th className="py-2 pr-4 font-medium">{membershipStrings.actions}</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.id} className="border-b border-border/60">
                  <td className="py-3 pr-4 font-medium">{member.displayName}</td>
                  <td className="py-3 pr-4 text-muted-foreground">{member.email}</td>
                  <td className="py-3 pr-4">
                    <span className="text-muted-foreground">
                      {member.roles.map((r) => r.name).join(", ") || "—"}
                    </span>
                  </td>
                  <td className="py-3 pr-4">
                    {member.active ? membershipStrings.active : membershipStrings.inactive}
                  </td>
                  <td className="py-3 pr-4">
                    <Link
                      href={`/app/${context.organizationId}/members/${member.id}`}
                      className="text-link underline-offset-4 hover:underline"
                    >
                      {membershipStrings.viewDetail}
                    </Link>
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
