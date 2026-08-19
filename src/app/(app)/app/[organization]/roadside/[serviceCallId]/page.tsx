import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shopos/page-header";
import { SummaryCard } from "@/components/shopos/states";
import { db } from "@/db/client";
import { formatDateTime } from "@/i18n/formatters";
import { getRequestContext } from "@/modules/tenancy/request-context";
import {
  getServiceCall,
  SERVICE_CALL_KIND_LABELS,
} from "@/modules/service-calls/service-call-service";
import { ServiceCallControls } from "./controls";
import { FieldPaymentCard } from "./field-payment-card";

export const dynamic = "force-dynamic";

/**
 * One roadside call end to end: the service location, the dispatch timeline,
 * and the controls to advance, cancel, or convert it into a shop work order.
 */
export default async function ServiceCallDetailPage({
  params,
}: {
  params: Promise<{ organization: string; serviceCallId: string }>;
}) {
  const { organization, serviceCallId } = await params;
  const context = await getRequestContext(organization);
  if (context.organizationId !== organization) {
    return <p className="text-destructive">Organization context mismatch.</p>;
  }

  const call = await getServiceCall({ db, context, serviceCallId });
  if (!call) notFound();

  const canWrite = context.permissions.has("work_orders.write");
  const canCollect = context.permissions.has("payments.record");
  const [members, assets] = canWrite
    ? await Promise.all([
        db.organizationMembership.findMany({
          where: { organizationId: context.organizationId, active: true },
          select: { userId: true, user: { select: { displayName: true } } },
          orderBy: { user: { displayName: "asc" } },
          take: 100,
        }),
        db.asset.findMany({
          where: { organizationId: context.organizationId, status: "ACTIVE" },
          select: { id: true, displayName: true },
          orderBy: { displayName: "asc" },
          take: 200,
        }),
      ])
    : [[], []];
  const technicians = members.map((member) => ({
    userId: member.userId,
    displayName: member.user.displayName,
  }));
  const fleetAssets = assets.map((asset) => ({ id: asset.id, displayName: asset.displayName }));

  const timeline = [
    { label: "Call taken", at: call.createdAt },
    { label: "Dispatched", at: call.dispatchedAt },
    { label: "En route", at: call.enRouteAt },
    { label: "On scene", at: call.onSceneAt },
    { label: "Completed", at: call.completedAt },
    { label: "Cancelled", at: call.cancelledAt },
  ].filter((entry) => entry.at !== null);

  const eta =
    call.etaSeconds !== null
      ? `${Math.max(1, Math.round(call.etaSeconds / 60))} min drive` +
        (call.distanceMeters !== null ? ` · ${(call.distanceMeters / 1000).toFixed(1)} km` : "")
      : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`${SERVICE_CALL_KIND_LABELS[call.kind]} — ${call.customerName}`}
        description={`Roadside service call · ${call.status.replace(/_/g, " ").toLowerCase()}`}
        breadcrumbs={[
          { label: "Roadside", href: `/app/${context.organizationId}/roadside` },
          { label: SERVICE_CALL_KIND_LABELS[call.kind] },
        ]}
      />

      <div className="grid gap-4 md:grid-cols-4">
        <SummaryCard
          label="Customer"
          value={
            <Link
              href={`/app/${context.organizationId}/customers/${call.customerId}`}
              className="text-link underline-offset-4 hover:underline"
            >
              {call.customerName}
            </Link>
          }
        />
        <SummaryCard
          label="Contact"
          value={
            <a
              href={`tel:${call.contactPhone}`}
              className="text-link underline-offset-4 hover:underline"
            >
              {call.contactPhone}
            </a>
          }
        />
        <SummaryCard label="Technician" value={call.technicianName ?? "Unassigned"} />
        <SummaryCard label="Drive" value={eta ?? "No route estimate"} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Service location</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <p className="font-medium">{call.geocodedFormatted ?? call.addressLine1}</p>
            {!call.geocodedFormatted ? (
              <p className="text-muted-foreground">
                {[call.addressLine2, `${call.city}, ${call.stateProvince} ${call.postalCode}`]
                  .filter(Boolean)
                  .join(", ")}
              </p>
            ) : (
              <p className="text-muted-foreground">
                {[
                  call.addressLine1,
                  call.addressLine2,
                  `${call.city}, ${call.stateProvince} ${call.postalCode}`,
                ]
                  .filter(Boolean)
                  .join(", ")}
              </p>
            )}
            {call.lat !== null && call.lng !== null ? (
              <p className="font-mono text-xs text-muted-foreground">
                {call.lat.toFixed(5)}, {call.lng.toFixed(5)}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Not geocoded — no maps connector configured.
              </p>
            )}
            {call.note ? <p className="border-t border-border pt-2">{call.note}</p> : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Timeline</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="flex flex-col gap-3">
              {timeline.map((entry) => (
                <li key={entry.label} className="flex items-baseline justify-between gap-4 text-sm">
                  <span>{entry.label}</span>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {formatDateTime(entry.at as Date, "UTC", "en-US")}
                  </span>
                </li>
              ))}
            </ol>
            {call.cancelReason ? (
              <p className="mt-3 border-t border-border pt-3 text-sm">
                <Badge variant="outline" className="mr-2 text-[10px]">
                  cancelled
                </Badge>
                {call.cancelReason}
              </p>
            ) : null}
            {call.workOrderId ? (
              <p className="mt-3 border-t border-border pt-3 text-sm">
                Work order{" "}
                <Link
                  href={`/app/${context.organizationId}/work-orders/${call.workOrderId}`}
                  className="font-mono text-link underline-offset-4 hover:underline"
                >
                  {call.workOrderNumber}
                </Link>
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {canWrite ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <ServiceCallControls
            orgId={context.organizationId}
            callId={call.id}
            status={call.status}
            technicians={technicians}
            fleetAssets={fleetAssets}
            converted={call.workOrderId !== null}
          />
          {canCollect ? <FieldPaymentCard orgId={context.organizationId} callId={call.id} /> : null}
        </div>
      ) : null}
    </div>
  );
}
