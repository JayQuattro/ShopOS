import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/db/client";
import { MembershipRepository } from "@/modules/memberships/membership-repository";
import { membershipStrings } from "@/modules/memberships/ui/strings";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { MembershipActions } from "./membership-actions";

const ASSIGNABLE_ROLES = [
  "owner",
  "manager",
  "advisor",
  "technician",
  "parts",
  "administrator",
] as const;

export default async function MemberDetailPage({
  params,
}: {
  params: Promise<{ organization: string; membershipId: string }>;
}) {
  const context = await getRequestContext();
  const { organization, membershipId } = await params;
  if (context.organizationId !== organization) {
    return <p className="text-destructive">{membershipStrings.errors.unauthorized}</p>;
  }

  const repo = new MembershipRepository({ db, context });
  const [member, locations] = await Promise.all([
    repo.findMembershipById(membershipId),
    repo.listLocations(),
  ]);

  if (!member) {
    return (
      <Card>
        <CardContent className="py-8">
          <p className="text-sm text-muted-foreground">Member not found.</p>
          <Link
            href={`/app/${context.organizationId}/members`}
            className="text-link underline-offset-4 hover:underline"
          >
            {membershipStrings.backToMembers}
          </Link>
        </CardContent>
      </Card>
    );
  }

  const assignedRoleKeys = new Set(member.roles.map((r) => r.key));

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{member.displayName}</CardTitle>
          <CardDescription>{member.email}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Badge variant={member.active ? "default" : "secondary"}>
            {member.active ? membershipStrings.active : membershipStrings.inactive}
          </Badge>
          {member.organizationWideLocationAccess ? (
            <Badge variant="outline">{membershipStrings.orgWide}</Badge>
          ) : null}
          <MembershipActions
            organizationId={context.organizationId}
            membershipId={member.id}
            active={member.active}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{membershipStrings.roleAssignment}</CardTitle>
          <CardDescription>{membershipStrings.assignRole}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {ASSIGNABLE_ROLES.map((roleKey) => {
            const assigned = assignedRoleKeys.has(roleKey);
            const label = roleKey.charAt(0).toUpperCase() + roleKey.slice(1);
            return (
              <RoleToggle
                key={roleKey}
                organizationId={context.organizationId}
                membershipId={member.id}
                roleKey={roleKey}
                label={label}
                assigned={assigned}
              />
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{membershipStrings.locationGrants}</CardTitle>
          <CardDescription>{membershipStrings.grantLocation}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          {locations.map((location) => {
            return (
              <LocationToggle
                key={location.id}
                organizationId={context.organizationId}
                membershipId={member.id}
                locationId={location.id}
                label={`${location.code} — ${location.name}`}
              />
            );
          })}
        </CardContent>
      </Card>

      <Link
        href={`/app/${context.organizationId}/members`}
        className="text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        {membershipStrings.backToMembers}
      </Link>
    </div>
  );
}

function RoleToggle(props: {
  organizationId: string;
  membershipId: string;
  roleKey: string;
  label: string;
  assigned: boolean;
}) {
  return (
    <form
      action={`/api/organizations/${props.organizationId}/members/${props.membershipId}/roles`}
      method="POST"
      className="contents"
    >
      <input type="hidden" name="roleKey" value={props.roleKey} />
      <Button
        type="submit"
        variant={props.assigned ? "secondary" : "outline"}
        size="sm"
        disabled={props.assigned}
      >
        {props.label}
      </Button>
    </form>
  );
}

function LocationToggle(props: {
  organizationId: string;
  membershipId: string;
  locationId: string;
  label: string;
}) {
  return (
    <form
      action={`/api/organizations/${props.organizationId}/members/${props.membershipId}/locations`}
      method="POST"
      className="flex items-center justify-between gap-3"
    >
      <input type="hidden" name="locationId" value={props.locationId} />
      <span className="text-sm">{props.label}</span>
      <Button type="submit" variant="outline" size="sm">
        {membershipStrings.grantLocation}
      </Button>
    </form>
  );
}
