import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/shopos/page-header";
import { db } from "@/db/client";
import { formatDateTime } from "@/i18n/formatters";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { listTransportJobs, type TransportJobSummary } from "@/modules/transport/transport-service";
import { NewTransportForm } from "./new-transport-form";
import { TransportCardActions } from "./actions";

export const dynamic = "force-dynamic";

const KIND_LABELS: Readonly<Record<TransportJobSummary["kind"], string>> = {
  PICKUP: "Pickup",
  DELIVERY: "Delivery",
};

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
 * Pickup & delivery board: the shop's vehicle logistics wall — runs to fetch
 * or return customer vehicles, with driver, shop vehicle, ETA, and the
 * customer's phone one tap away.
 */
export default async function LogisticsPage({
  params,
}: {
  params: Promise<{ organization: string }>;
}) {
  const { organization } = await params;
  const context = await getRequestContext(organization);
  if (context.organizationId !== organization) {
    return <p className="text-destructive">Organization context mismatch.</p>;
  }

  const jobs = await listTransportJobs({ db, context });
  const members = await db.organizationMembership.findMany({
    where: { organizationId: context.organizationId, active: true },
    select: { userId: true, user: { select: { displayName: true } } },
    orderBy: { user: { displayName: "asc" } },
    take: 100,
  });
  const drivers = members.map((member) => ({
    userId: member.userId,
    displayName: member.user.displayName,
  }));
  const canWrite = context.permissions.has("work_orders.write");

  const [customers, locations, fleetVehicles] = canWrite
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
        db.asset.findMany({
          where: { organizationId: context.organizationId, status: "ACTIVE", isFleetVehicle: true },
          select: { id: true, displayName: true },
          orderBy: { displayName: "asc" },
          take: 100,
        }),
      ])
    : [[], [], []];

  const open = jobs.filter((job) => job.status === "SCHEDULED" || job.status === "EN_ROUTE");
  const finished = jobs.filter((job) => job.status === "COMPLETED" || job.status === "CANCELLED");
  const columns: ReadonlyArray<TransportJobSummary["status"]> = ["SCHEDULED", "EN_ROUTE"];

  const orgId = context.organizationId;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Pickup & delivery"
        description="Fetch and return customer vehicles — drivers, shop vehicles, and ETAs."
        breadcrumbs={[{ label: "Pickup & delivery" }]}
      />

      {canWrite ? (
        <NewTransportForm orgId={orgId} customers={customers} locations={locations} />
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        {columns.map((column) => {
          const columnJobs = open.filter((job) => job.status === column);
          return (
            <div key={column} className="flex min-w-0 flex-col gap-2">
              <div className="flex items-baseline justify-between">
                <p className="text-sm font-semibold">
                  {column === "SCHEDULED" ? "Scheduled" : "En route"}
                </p>
                <span className="font-mono text-xs text-muted-foreground">{columnJobs.length}</span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {column === "SCHEDULED" ? "Waiting on a driver" : "Vehicle is moving"}
              </p>
              <div className="flex flex-col gap-2 rounded-lg bg-muted/40 p-2">
                {columnJobs.length === 0 ? (
                  <p className="px-1 py-3 text-center text-xs text-muted-foreground">Empty</p>
                ) : (
                  columnJobs.map((job) => (
                    <div key={job.id} className="rounded-lg border border-border bg-card p-3">
                      <div className="flex items-center justify-between gap-2">
                        <Badge variant="secondary" className="text-[10px]">
                          {KIND_LABELS[job.kind]}
                        </Badge>
                        {job.scheduledAt ? (
                          <span className="font-mono text-xs text-muted-foreground">
                            {formatDateTime(job.scheduledAt, "UTC", "en-US")}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 truncate text-sm font-medium">{job.customerName}</p>
                      {job.assetName ? (
                        <p className="truncate text-xs text-muted-foreground">{job.assetName}</p>
                      ) : null}
                      <a
                        href={`tel:${job.contactPhone}`}
                        className="font-mono text-xs text-link underline-offset-4 hover:underline"
                      >
                        {job.contactPhone}
                      </a>
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                        {job.geocodedFormatted ??
                          `${job.addressLine1}, ${job.city} ${job.stateProvince}`}
                      </p>
                      {job.workOrderNumber ? (
                        <Link
                          href={`/app/${orgId}/work-orders/${job.workOrderId}`}
                          className="mt-1 inline-block font-mono text-xs text-link underline-offset-4 hover:underline"
                        >
                          {job.workOrderNumber}
                        </Link>
                      ) : null}
                      <div className="mt-2 flex flex-wrap gap-1">
                        {job.driverName ? (
                          <Badge variant="outline" className="text-[10px]">
                            {job.driverName}
                          </Badge>
                        ) : null}
                        {job.fleetAssetName ? (
                          <Badge variant="outline" className="text-[10px]">
                            {job.fleetAssetName}
                          </Badge>
                        ) : null}
                        {etaLabel(job.etaSeconds, job.distanceMeters) ? (
                          <Badge variant="outline" className="text-[10px]">
                            ETA {etaLabel(job.etaSeconds, job.distanceMeters)}
                          </Badge>
                        ) : null}
                      </div>
                      {canWrite ? (
                        <TransportCardActions
                          orgId={orgId}
                          jobId={job.id}
                          status={job.status}
                          drivers={drivers}
                          fleetVehicles={fleetVehicles}
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
                  <th className="px-4 py-3 font-medium">Run</th>
                  <th className="px-4 py-3 font-medium">Customer</th>
                  <th className="px-4 py-3 font-medium">Outcome</th>
                </tr>
              </thead>
              <tbody>
                {finished.slice(0, 10).map((job) => (
                  <tr key={job.id} className="border-b border-border/60 hover:bg-muted/30">
                    <td className="px-4 py-3 font-mono text-xs tabular-nums text-muted-foreground">
                      {formatDateTime(
                        job.completedAt ?? job.cancelledAt ?? job.createdAt,
                        "UTC",
                        "en-US",
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {KIND_LABELS[job.kind]}
                      {job.driverName ? ` · ${job.driverName}` : ""}
                    </td>
                    <td className="px-4 py-3">{job.customerName}</td>
                    <td className="px-4 py-3">
                      {job.status === "COMPLETED" ? (
                        <Badge variant="secondary" className="text-[10px]">
                          done
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px]">
                          cancelled — {job.cancelReason ?? ""}
                        </Badge>
                      )}
                    </td>
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
