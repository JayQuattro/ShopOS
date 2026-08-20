import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/shopos/page-header";
import { db } from "@/db/client";
import { formatDate, formatDateTime } from "@/i18n/formatters";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { listFleetCandidates, listFleetVehicles } from "@/modules/assets/fleet-service";
import { SERVICE_CALL_KIND_LABELS } from "@/modules/service-calls/service-call-service";
import { FleetToggle } from "./fleet-toggle";

export const dynamic = "force-dynamic";

/**
 * The shop's own vehicles: fleet membership (the explicit signal loaner and
 * roadside pickers prefer), live loaner state, and open roadside assignments.
 */
export default async function FleetPage({ params }: { params: Promise<{ organization: string }> }) {
  const { organization } = await params;
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

      <Card>
        <CardContent className="p-0">
          {vehicles.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-muted-foreground">
              No fleet vehicles marked yet. Mark a shop vehicle above — or from its asset page — and
              it becomes the first choice for loaners and roadside dispatch.
            </p>
          ) : (
            <>
              <p className="border-b border-border px-4 py-3 text-sm text-muted-foreground">
                {vehicles.length} vehicle{vehicles.length === 1 ? "" : "s"} · {outCount} out on loan
              </p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="px-4 py-3 font-medium">Vehicle</th>
                    <th className="px-4 py-3 font-medium">Plate</th>
                    <th className="px-4 py-3 font-medium">Mileage</th>
                    <th className="px-4 py-3 font-medium">Reserved</th>
                    <th className="px-4 py-3 font-medium">Loaner</th>
                    <th className="px-4 py-3 font-medium">Roadside</th>
                    {canWrite ? <th className="px-4 py-3 font-medium"></th> : null}
                  </tr>
                </thead>
                <tbody>
                  {vehicles.map((vehicle) => (
                    <tr key={vehicle.id} className="border-b border-border/60 hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <Link
                          href={`/app/${orgId}/assets/${vehicle.id}`}
                          className="text-link underline-offset-4 hover:underline"
                        >
                          {vehicle.displayName}
                        </Link>
                        {vehicle.status !== "ACTIVE" ? (
                          <Badge variant="outline" className="ml-2 text-[10px]">
                            {vehicle.status.toLowerCase()}
                          </Badge>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">
                        {vehicle.licensePlate
                          ? `${vehicle.licensePlate}${vehicle.plateJurisdiction ? ` · ${vehicle.plateJurisdiction}` : ""}`
                          : "—"}
                      </td>
                      <td className="px-4 py-3 font-mono tabular-nums">
                        {vehicle.mileage?.toLocaleString("en-US") ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        {vehicle.loanerStatus.out ? (
                          <span className="text-xs">
                            <Badge variant="secondary" className="mr-2 text-[10px]">
                              out
                            </Badge>
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
                          </span>
                        ) : (
                          <Badge variant="outline" className="text-[10px]">
                            available
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {(reservationsByAsset.get(vehicle.id) ?? []).length === 0 ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <ul className="flex flex-col gap-0.5">
                            {(reservationsByAsset.get(vehicle.id) ?? []).map((entry, index) => (
                              <li key={index} className="text-xs">
                                📅 {entry.window}
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {vehicle.openServiceCalls.length === 0 ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <span className="flex flex-wrap gap-1">
                            {vehicle.openServiceCalls.map((call) => (
                              <Link
                                key={call.id}
                                href={`/app/${orgId}/roadside/${call.id}`}
                                className="rounded-full"
                              >
                                <Badge variant="secondary" className="text-[10px]">
                                  {
                                    SERVICE_CALL_KIND_LABELS[
                                      call.kind as keyof typeof SERVICE_CALL_KIND_LABELS
                                    ]
                                  }
                                </Badge>
                              </Link>
                            ))}
                          </span>
                        )}
                      </td>
                      {canWrite ? (
                        <td className="px-4 py-3 text-right">
                          <FleetToggle assetId={vehicle.id} assetName={vehicle.displayName} />
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
