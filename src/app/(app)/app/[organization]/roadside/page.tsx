import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/shopos/page-header";
import { db } from "@/db/client";
import { formatDateTime } from "@/i18n/formatters";
import { getRequestContext } from "@/modules/tenancy/request-context";
import {
  listServiceCalls,
  SERVICE_CALL_KIND_LABELS,
  type ServiceCallSummary,
} from "@/modules/service-calls/service-call-service";
import { NewServiceCallForm } from "./new-call-form";
import { RoadsideCardActions } from "./actions";

export const dynamic = "force-dynamic";

const COLUMNS: ReadonlyArray<{
  status: ServiceCallSummary["status"];
  label: string;
  hint: string;
}> = [
  { status: "REQUESTED", label: "Requested", hint: "Take the call, pick a tech" },
  { status: "DISPATCHED", label: "Dispatched", hint: "Truck is rolling" },
  { status: "EN_ROUTE", label: "En route", hint: "" },
  { status: "ON_SCENE", label: "On scene", hint: "Working it now" },
];

function etaLabel(etaSeconds: number | null, distanceMeters: number | null): string {
  if (etaSeconds === null && distanceMeters === null) return "";
  const parts: string[] = [];
  if (etaSeconds !== null) {
    const minutes = Math.round(etaSeconds / 60);
    parts.push(minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes} min`);
  }
  if (distanceMeters !== null) {
    const km = distanceMeters / 1000;
    parts.push(km >= 10 ? `${Math.round(km)} km` : `${km.toFixed(1)} km`);
  }
  return parts.join(" · ");
}

/**
 * Roadside dispatch board: on-the-road service calls by status, with the
 * customer's phone one tap away. Quick actions advance the call in place;
 * the detail page carries the full timeline and conversion to a work order.
 */
export default async function RoadsidePage({
  params,
}: {
  params: Promise<{ organization: string }>;
}) {
  const { organization } = await params;
  const context = await getRequestContext(organization);
  if (context.organizationId !== organization) {
    return <p className="text-destructive">Organization context mismatch.</p>;
  }

  const [calls, recent] = await Promise.all([
    listServiceCalls({ db, context, openOnly: true }),
    listServiceCalls({ db, context }),
  ]);
  const members = await db.organizationMembership.findMany({
    where: { organizationId: context.organizationId, active: true },
    select: { userId: true, user: { select: { displayName: true } } },
    orderBy: { user: { displayName: "asc" } },
    take: 100,
  });
  const technicians = members.map((member) => ({
    userId: member.userId,
    displayName: member.user.displayName,
  }));
  const canWrite = context.permissions.has("work_orders.write");

  const orgCountry = await db.organization
    .findUnique({ where: { id: context.organizationId }, select: { country: true } })
    .then((org) => org?.country ?? null);

  const [customers, locations] = canWrite
    ? await Promise.all([
        db.customer.findMany({
          where: { organizationId: context.organizationId, archivedAt: null },
          select: { id: true, displayName: true },
          orderBy: { displayName: "asc" },
          take: 200,
        }),
        db.location.findMany({
          where: {
            organizationId: context.organizationId,
            active: true,
            ...(context.organizationWideLocationAccess
              ? {}
              : { id: { in: [...context.allowedLocationIds] } }),
          },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        }),
      ])
    : [[], []];

  const finished = recent
    .filter((call) => call.status === "COMPLETED" || call.status === "CANCELLED")
    .slice(0, 10);

  const byStatus = new Map<ServiceCallSummary["status"], ServiceCallSummary[]>(
    COLUMNS.map((column) => [column.status, []]),
  );
  for (const call of calls) {
    byStatus.get(call.status)?.push(call);
  }

  const orgId = context.organizationId;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Roadside"
        description="Mobile service calls — jumpstarts, tire changes, lockouts, mobile repair."
        breadcrumbs={[{ label: "Roadside" }]}
      />

      {canWrite ? (
        <NewServiceCallForm
          orgId={orgId}
          customers={customers}
          locations={locations}
          defaultCountry={orgCountry}
        />
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {COLUMNS.map((column) => {
          const columnCalls = byStatus.get(column.status) ?? [];
          return (
            <div key={column.status} className="flex min-w-0 flex-col gap-2">
              <div className="flex items-baseline justify-between">
                <p className="text-sm font-semibold">{column.label}</p>
                <span className="font-mono text-xs text-muted-foreground">
                  {columnCalls.length}
                </span>
              </div>
              {column.hint ? (
                <p className="text-[11px] text-muted-foreground">{column.hint}</p>
              ) : null}
              <div className="flex flex-col gap-2 rounded-lg bg-muted/40 p-2">
                {columnCalls.length === 0 ? (
                  <p className="px-1 py-3 text-center text-xs text-muted-foreground">Empty</p>
                ) : (
                  columnCalls.map((call) => (
                    <div key={call.id} className="rounded-lg border border-border bg-card p-3">
                      <div className="flex items-center justify-between gap-2">
                        <Badge variant="secondary" className="text-[10px]">
                          {SERVICE_CALL_KIND_LABELS[call.kind]}
                        </Badge>
                        {call.workOrderNumber ? (
                          <Link
                            href={`/app/${orgId}/work-orders/${call.workOrderId}`}
                            className="font-mono text-xs text-link underline-offset-4 hover:underline"
                          >
                            {call.workOrderNumber}
                          </Link>
                        ) : null}
                      </div>
                      <Link
                        href={`/app/${orgId}/roadside/${call.id}`}
                        className="mt-1 block truncate text-sm font-medium hover:underline"
                      >
                        {call.customerName}
                      </Link>
                      <a
                        href={`tel:${call.contactPhone}`}
                        className="font-mono text-xs text-link underline-offset-4 hover:underline"
                      >
                        {call.contactPhone}
                      </a>
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                        {call.geocodedFormatted ??
                          `${call.addressLine1}, ${call.city} ${call.stateProvince}`}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {call.technicianName ? (
                          <Badge variant="outline" className="text-[10px]">
                            {call.technicianName}
                          </Badge>
                        ) : null}
                        {call.fleetAssetName ? (
                          <Badge variant="outline" className="text-[10px]">
                            {call.fleetAssetName}
                          </Badge>
                        ) : null}
                        {etaLabel(call.etaSeconds, call.distanceMeters) ? (
                          <Badge variant="outline" className="text-[10px]">
                            ETA {etaLabel(call.etaSeconds, call.distanceMeters)}
                          </Badge>
                        ) : null}
                      </div>
                      {canWrite ? (
                        <RoadsideCardActions
                          orgId={orgId}
                          callId={call.id}
                          status={call.status}
                          technicians={technicians}
                        />
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      {finished.length > 0 ? (
        <Card>
          <CardContent className="p-0">
            <p className="border-b border-border px-4 py-3 text-sm text-muted-foreground">
              Recently finished
            </p>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="px-4 py-3 font-medium">When</th>
                  <th className="px-4 py-3 font-medium">Kind</th>
                  <th className="px-4 py-3 font-medium">Customer</th>
                  <th className="px-4 py-3 font-medium">Outcome</th>
                  <th className="px-4 py-3 font-medium">Work order</th>
                </tr>
              </thead>
              <tbody>
                {finished.map((call) => (
                  <tr key={call.id} className="border-b border-border/60 hover:bg-muted/30">
                    <td className="px-4 py-3 font-mono text-xs tabular-nums text-muted-foreground">
                      {formatDateTime(
                        call.completedAt ?? call.cancelledAt ?? call.createdAt,
                        "UTC",
                        "en-US",
                      )}
                    </td>
                    <td className="px-4 py-3">{SERVICE_CALL_KIND_LABELS[call.kind]}</td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/app/${orgId}/roadside/${call.id}`}
                        className="text-link underline-offset-4 hover:underline"
                      >
                        {call.customerName}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      {call.status === "COMPLETED" ? (
                        <Badge variant="secondary" className="text-[10px]">
                          completed
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px]">
                          cancelled — {call.cancelReason ?? ""}
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{call.workOrderNumber ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
