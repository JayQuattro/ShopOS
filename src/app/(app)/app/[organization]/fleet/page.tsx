import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ListSearch } from "@/components/shopos/list-search";
import { PageHeader } from "@/components/shopos/page-header";
import { EmptyState } from "@/components/shopos/states";
import { db } from "@/db/client";
import { formatDate, formatDateTime } from "@/i18n/formatters";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { listFleetCandidates, listFleetVehicles } from "@/modules/assets/fleet-service";
import { SERVICE_CALL_KIND_LABELS } from "@/modules/service-calls/service-call-service";
import { humanizeToken } from "@/lib/labels";
import { FleetDocsEditor } from "./fleet-docs-editor";
import { FleetToggle } from "./fleet-toggle";

export const dynamic = "force-dynamic";

type FleetVehicle = Awaited<ReturnType<typeof listFleetVehicles>>[number];

/** Registration/insurance expiry badges with overdue and due-soon states. */
function fleetDocBadges(vehicle: FleetVehicle): Array<{
  label: string;
  date: Date;
  overdue: boolean;
  soon: boolean;
}> {
  const now = Date.now();
  const soonThreshold = now + 30 * 24 * 60 * 60 * 1000;
  const docs: Array<{ label: string; date: Date; overdue: boolean; soon: boolean }> = [];
  if (vehicle.registrationExpiresAt) {
    docs.push({
      label: "REG",
      date: vehicle.registrationExpiresAt,
      overdue: vehicle.registrationExpiresAt.getTime() < now,
      soon: vehicle.registrationExpiresAt.getTime() < soonThreshold,
    });
  }
  if (vehicle.insuranceExpiresAt) {
    docs.push({
      label: "INS",
      date: vehicle.insuranceExpiresAt,
      overdue: vehicle.insuranceExpiresAt.getTime() < now,
      soon: vehicle.insuranceExpiresAt.getTime() < soonThreshold,
    });
  }
  return docs;
}

/**
 * The shop's own vehicles: fleet membership (the explicit signal loaner and
 * roadside pickers prefer), live loaner state, and open roadside assignments.
 */
export default async function FleetPage({
  params,
  searchParams,
}: {
  params: Promise<{ organization: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { organization } = await params;
  const { q: search } = await searchParams;
  const context = await getRequestContext(organization);
  if (context.organizationId !== organization) {
    return <p className="text-destructive">Organization context mismatch.</p>;
  }

  const [vehicles, candidates, reservations] = await Promise.all([
    listFleetVehicles({ db, context }),
    listFleetCandidates({ db, context }),
    db.loanerReservation.findMany({
      where: {
        organizationId: context.organizationId,
        status: "reserved",
        reservedTo: { gte: new Date() },
      },
      orderBy: { reservedFrom: "asc" },
      select: {
        assetId: true,
        reservedFrom: true,
        reservedTo: true,
        customer: { select: { displayName: true } },
      },
    }),
  ]);
  const reservationsByAsset = new Map<string, Array<{ window: string }>>();
  for (const reservation of reservations) {
    const entry = reservationsByAsset.get(reservation.assetId) ?? [];
    entry.push({
      window: `${formatDate(reservation.reservedFrom, "UTC", "en-US")} → ${formatDate(
        reservation.reservedTo,
        "UTC",
        "en-US",
      )} (${reservation.customer.displayName})`,
    });
    reservationsByAsset.set(reservation.assetId, entry);
  }
  const canWrite = context.permissions.has("assets.write");
  const orgId = context.organizationId;
  const outCount = vehicles.filter((vehicle) => vehicle.loanerStatus.out).length;

  const query = search?.trim().toLowerCase() ?? "";
  const shown = query
    ? vehicles.filter((vehicle) =>
        [
          vehicle.displayName,
          vehicle.licensePlate ?? "",
          vehicle.loanerStatus.workOrderNumber ?? "",
        ].some((field) => field.toLowerCase().includes(query)),
      )
    : vehicles;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Fleet"
        description="Shop vehicles — loaners and service trucks, at a glance."
        breadcrumbs={[{ label: "Fleet" }]}
      />

      {canWrite && candidates.length > 0 ? (
        <FleetToggle candidates={candidates.map((asset) => ({ ...asset }))} add />
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <ListSearch
          action={`/app/${orgId}/fleet`}
          query={search?.trim() ?? ""}
          placeholder="Search vehicle, plate, loan…"
        />
        <p className="text-sm text-muted-foreground">
          {vehicles.length} vehicle{vehicles.length === 1 ? "" : "s"} · {outCount} out on loan
        </p>
      </div>

      {vehicles.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              title="No fleet vehicles marked yet"
              description="Mark a shop vehicle above — or from its asset page — and it becomes the first choice for loaners and roadside dispatch."
            />
          </CardContent>
        </Card>
      ) : shown.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              title="No fleet vehicles match your search"
              description={`Nothing found for “${search?.trim()}”.`}
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((vehicle) => {
            const docs = fleetDocBadges(vehicle);
            return (
              <Card key={vehicle.id}>
                <CardContent className="flex flex-col gap-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        href={`/app/${orgId}/assets/${vehicle.id}`}
                        className="text-sm font-medium text-link underline-offset-4 hover:underline"
                      >
                        {vehicle.displayName}
                      </Link>
                      <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                        {[
                          vehicle.licensePlate
                            ? `${vehicle.licensePlate}${vehicle.plateJurisdiction ? ` · ${vehicle.plateJurisdiction}` : ""}`
                            : null,
                          vehicle.mileage ? `${vehicle.mileage.toLocaleString("en-US")} mi` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "No plate or mileage"}
                      </p>
                    </div>
                    {vehicle.loanerStatus.out ? (
                      <Badge variant="secondary">out on loan</Badge>
                    ) : (
                      <Badge variant="outline">available</Badge>
                    )}
                  </div>

                  {vehicle.status !== "ACTIVE" ? (
                    <Badge variant="outline" className="w-fit text-[10px]">
                      {humanizeToken(vehicle.status)}
                    </Badge>
                  ) : null}

                  {vehicle.loanerStatus.out ? (
                    <p className="text-xs text-muted-foreground">
                      {vehicle.loanerStatus.workOrderNumber ? (
                        <Link
                          href={`/app/${orgId}/work-orders`}
                          className="font-mono text-link underline-offset-4 hover:underline"
                        >
                          {vehicle.loanerStatus.workOrderNumber}
                        </Link>
                      ) : null}
                      {vehicle.loanerStatus.since
                        ? ` since ${formatDateTime(vehicle.loanerStatus.since, "UTC", "en-US")}`
                        : ""}
                    </p>
                  ) : null}

                  {docs.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {docs.map((doc) => (
                        <Badge
                          key={doc.label}
                          variant={doc.overdue ? "destructive" : doc.soon ? "default" : "outline"}
                          className="text-[10px]"
                        >
                          {doc.label} {formatDate(doc.date, "UTC", "en-US")}
                          {doc.overdue ? " · overdue" : ""}
                        </Badge>
                      ))}
                    </div>
                  ) : null}

                  {vehicle.maintenanceDue.length > 0 ? (
                    <div className="flex flex-col gap-0.5">
                      {vehicle.maintenanceDue.map((schedule) => (
                        <p key={schedule.id} className="text-xs">
                          🔧 {schedule.name}
                          {schedule.dueInMiles !== null
                            ? schedule.dueInMiles <= 0
                              ? " · overdue"
                              : ` · in ${schedule.dueInMiles.toLocaleString("en-US")} mi`
                            : schedule.dueInDays !== null
                              ? schedule.dueInDays <= 0
                                ? " · overdue"
                                : ` · in ${schedule.dueInDays} d`
                              : ""}
                        </p>
                      ))}
                    </div>
                  ) : null}

                  {(reservationsByAsset.get(vehicle.id) ?? []).length > 0 ? (
                    <div className="flex flex-col gap-0.5">
                      {(reservationsByAsset.get(vehicle.id) ?? []).map((entry, index) => (
                        <p key={index} className="text-xs">
                          📅 {entry.window}
                        </p>
                      ))}
                    </div>
                  ) : null}

                  {vehicle.openServiceCalls.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {vehicle.openServiceCalls.map((call) => (
                        <Link key={call.id} href={`/app/${orgId}/roadside/${call.id}`}>
                          <Badge variant="secondary" className="text-[10px]">
                            {
                              SERVICE_CALL_KIND_LABELS[
                                call.kind as keyof typeof SERVICE_CALL_KIND_LABELS
                              ]
                            }
                          </Badge>
                        </Link>
                      ))}
                    </div>
                  ) : null}

                  {canWrite ? (
                    <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
                      <FleetToggle assetId={vehicle.id} assetName={vehicle.displayName} />
                      <FleetDocsEditor
                        assetId={vehicle.id}
                        registration={
                          vehicle.registrationExpiresAt
                            ? vehicle.registrationExpiresAt.toISOString().slice(0, 10)
                            : ""
                        }
                        insurance={
                          vehicle.insuranceExpiresAt
                            ? vehicle.insuranceExpiresAt.toISOString().slice(0, 10)
                            : ""
                        }
                      />
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
