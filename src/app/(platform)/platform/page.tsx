import Link from "next/link";

import { db } from "@/db/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { listPlatformOrganizations } from "@/modules/platform/organizations";
import { getPlatformRequestContext } from "@/modules/platform/request-context";

export default async function PlatformOrganizationsPage() {
  const context = await getPlatformRequestContext();
  const organizations = await listPlatformOrganizations(db, context);
  const canProvision = context.permissions.has("platform.organizations.provision");

  return (
    <div className="grid gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-2">
          <p className="text-sm font-medium text-muted-foreground">Platform administration</p>
          <h1 className="text-3xl font-semibold tracking-tight">Organizations</h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Manage tenant lifecycle and entitlements without entering tenant operational data.
          </p>
        </div>
        {canProvision ? (
          <Button asChild>
            <Link href="/platform/organizations/new">Provision organization</Link>
          </Button>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{organizations.length} organizations</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="border-y border-border bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-6 py-3 font-medium">Organization</th>
                  <th className="px-6 py-3 font-medium">State</th>
                  <th className="px-6 py-3 font-medium">Subscription</th>
                  <th className="px-6 py-3 font-medium">Locations</th>
                  <th className="px-6 py-3 font-medium">Members</th>
                  <th className="px-6 py-3 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {organizations.map((organization) => (
                  <tr key={organization.id} className="border-b border-border last:border-0">
                    <td className="px-6 py-4">
                      <Link
                        className="font-medium text-link hover:underline"
                        href={`/platform/organizations/${organization.id}`}
                      >
                        {organization.name}
                      </Link>
                      <div className="mt-1 text-xs text-muted-foreground">{organization.slug}</div>
                    </td>
                    <td className="px-6 py-4">
                      <Badge variant={organization.status === "ACTIVE" ? "default" : "secondary"}>
                        {organization.status.toLowerCase()}
                      </Badge>
                    </td>
                    <td className="px-6 py-4 text-muted-foreground">
                      {organization.subscriptionState.toLowerCase()}
                    </td>
                    <td className="px-6 py-4">{organization.locationCount}</td>
                    <td className="px-6 py-4">{organization.membershipCount}</td>
                    <td className="px-6 py-4 text-muted-foreground">
                      {organization.createdAt.toLocaleDateString("en-US")}
                    </td>
                  </tr>
                ))}
                {organizations.length === 0 ? (
                  <tr>
                    <td className="px-6 py-12 text-center text-muted-foreground" colSpan={6}>
                      No organizations have been provisioned.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
