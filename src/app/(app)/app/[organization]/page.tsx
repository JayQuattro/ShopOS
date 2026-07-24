import Link from "next/link";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shopos/page-header";
import { db } from "@/db/client";
import { getRequestContext } from "@/modules/tenancy/request-context";

/**
 * Organization dashboard — the post-sign-in / post-onboarding landing experience.
 * Shows permission-aware summary cards (member count, customer count) so an
 * actor immediately sees their organization's scope without leaking data they
 * cannot access.
 */
export default async function OrganizationDashboardPage({
  params,
}: {
  params: Promise<{ organization: string }>;
}) {
  const context = await getRequestContext();
  const { organization } = await params;
  if (context.organizationId !== organization) {
    return <p className="text-destructive">Organization context mismatch.</p>;
  }

  const [memberCount, customerCount] = await Promise.all([
    db.organizationMembership.count({
      where: { organizationId: context.organizationId, active: true },
    }),
    context.permissions.has("customers.read")
      ? db.customer.count({ where: { organizationId: context.organizationId } })
      : Promise.resolve(null),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Overview"
        description="Your organization at a glance."
        breadcrumbs={[{ label: "Overview" }]}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {context.permissions.has("memberships.manage") ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Active members</CardTitle>
            </CardHeader>
            <CardContent>
              <span className="font-mono text-2xl font-semibold tabular-nums">{memberCount}</span>
              <Link
                href={`/app/${context.organizationId}/members`}
                className="ml-2 text-sm text-link underline-offset-4 hover:underline"
              >
                Manage →
              </Link>
            </CardContent>
          </Card>
        ) : null}

        {customerCount !== null ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Customers</CardTitle>
            </CardHeader>
            <CardContent>
              <span className="font-mono text-2xl font-semibold tabular-nums">{customerCount}</span>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Getting started</CardTitle>
            <CardDescription>Next steps for your shop.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
              <li>Invite team members and assign roles</li>
              <li>Add customers and their assets</li>
              <li>Create work orders and estimates</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
