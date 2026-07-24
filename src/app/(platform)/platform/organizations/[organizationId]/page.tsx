import Link from "next/link";
import { notFound } from "next/navigation";

import { db } from "@/db/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getPlatformOrganization } from "@/modules/platform/organizations";
import { getPlatformRequestContext } from "@/modules/platform/request-context";

import { OrganizationStatusAction } from "./status-action";

export default async function PlatformOrganizationPage({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  const context = await getPlatformRequestContext();
  const { organizationId } = await params;
  const organization = await getPlatformOrganization(db, context, organizationId);
  if (!organization) {
    notFound();
  }
  const canChangeStatus = context.permissions.has("platform.organizations.suspend");

  return (
    <div className="grid gap-8">
      <Button asChild variant="link" className="justify-self-start">
        <Link href="/platform">← Back to organizations</Link>
      </Button>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-2">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-tight">{organization.name}</h1>
            <Badge variant={organization.status === "ACTIVE" ? "default" : "secondary"}>
              {organization.status.toLowerCase()}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">{organization.slug}</p>
        </div>
        {canChangeStatus &&
        (organization.status === "ACTIVE" || organization.status === "SUSPENDED") ? (
          <OrganizationStatusAction
            organizationId={organization.id}
            currentStatus={organization.status}
          />
        ) : null}
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <SummaryCard label="Subscription" value={organization.subscriptionState.toLowerCase()} />
        <SummaryCard label="Currency" value={organization.defaultCurrency} />
        <SummaryCard label="Created" value={organization.createdAt.toLocaleDateString("en-US")} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Locations</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            {organization.locations.map((location) => (
              <div key={location.id} className="rounded-md border border-border p-4">
                <div className="font-medium">{location.name}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {location.code} · {location.timeZone}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Entitlements</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            {organization.entitlements.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No explicit entitlements. Platform defaults apply.
              </p>
            ) : (
              organization.entitlements.map((entitlement) => (
                <div
                  key={entitlement.id}
                  className="flex items-center justify-between rounded-md border border-border p-4"
                >
                  <span className="font-medium">{entitlement.key}</span>
                  <Badge variant={entitlement.enabled ? "default" : "secondary"}>
                    {entitlement.enabled ? "enabled" : "disabled"}
                  </Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Platform audit history</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          {organization.auditEvents.map((event) => (
            <div key={event.id} className="border-b border-border pb-3 last:border-0">
              <div className="text-sm font-medium">{event.action}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {event.occurredAt.toLocaleString("en-US")}
                {event.reason ? ` · ${event.reason}` : ""}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="text-xs font-medium text-muted-foreground">{label}</div>
        <div className="mt-2 text-lg font-semibold capitalize">{value}</div>
      </CardContent>
    </Card>
  );
}
