import Link from "next/link";

import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/shopos/page-header";
import { StatusBadge } from "@/components/shopos/status-badge";
import { db } from "@/db/client";
import { formatDate, formatDateTime } from "@/i18n/formatters";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { listAppointmentsInRange } from "@/modules/appointments/appointment-service";
import { AppointmentActions } from "./appointment-actions";
import { AppointmentCreateForm } from "./appointment-create-form";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Offset of an IANA time zone from UTC at the given instant, in minutes. */
function timeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
  }).formatToParts(date);
  const name = parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT+00:00";
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  if (!match) return 0;
  const [, sign, hours, minutes] = match;
  const total = Number(hours) * 60 + Number(minutes);
  return sign === "-" ? -total : total;
}

/**
 * UTC bounds of a calendar day (YYYY-MM-DD) in the given IANA zone, adjusted
 * twice so DST boundaries land on the right day.
 */
function dayBounds(dateStr: string, timeZone: string): { from: Date; to: Date } {
  const naive = new Date(`${dateStr}T00:00:00Z`);
  const firstPass = new Date(naive.getTime() - timeZoneOffsetMinutes(naive, timeZone) * 60_000);
  const from = new Date(naive.getTime() - timeZoneOffsetMinutes(firstPass, timeZone) * 60_000);
  return { from, to: new Date(from.getTime() + DAY_MS) };
}

function isValidDateStr(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime())
  );
}

function shiftDate(dateStr: string, days: number): string {
  return new Date(new Date(`${dateStr}T00:00:00Z`).getTime() + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

export default async function SchedulePage({
  params,
  searchParams,
}: {
  params: Promise<{ organization: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  const { organization } = await params;
  const context = await getRequestContext(organization);
  const { date: dateParam } = await searchParams;
  if (context.organizationId !== organization) {
    return <p className="text-destructive">Organization context mismatch.</p>;
  }

  const canWrite = context.permissions.has("work_orders.write");
  const locations = await db.location.findMany({
    where: {
      organizationId: context.organizationId,
      active: true,
      ...(context.organizationWideLocationAccess
        ? {}
        : { id: { in: [...context.allowedLocationIds] } }),
    },
    select: { id: true, name: true, timeZone: true },
    orderBy: { code: "asc" },
  });

  const timeZone = locations[0]?.timeZone ?? "UTC";
  const today = new Date().toISOString().slice(0, 10);
  const date = dateParam && isValidDateStr(dateParam) ? dateParam : today;
  const { from, to } = dayBounds(date, timeZone);

  const [appointments, customers, assets] = await Promise.all([
    listAppointmentsInRange({ db, context, from, to }),
    canWrite
      ? db.customer.findMany({
          where: { organizationId: context.organizationId, archivedAt: null },
          select: { id: true, displayName: true },
          take: 200,
          orderBy: { displayName: "asc" },
        })
      : Promise.resolve([]),
    canWrite
      ? db.asset.findMany({
          where: { organizationId: context.organizationId, status: "ACTIVE" },
          select: { id: true, displayName: true, customerId: true },
          take: 200,
          orderBy: { displayName: "asc" },
        })
      : Promise.resolve([]),
  ]);

  const locationNames = new Map(locations.map((location) => [location.id, location.name]));
  const base = `/app/${context.organizationId}/schedule`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Schedule"
        description="What's coming in the door."
        breadcrumbs={[{ label: "Schedule" }]}
        actions={
          canWrite ? (
            <AppointmentCreateForm
              customers={customers}
              assets={assets}
              locations={locations.map((location) => ({
                id: location.id,
                displayName: location.name,
              }))}
              date={date}
            />
          ) : undefined
        }
      />

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link
            href={`${base}?date=${shiftDate(date, -1)}`}
            className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted"
          >
            ← Previous
          </Link>
          <Link
            href={base}
            className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted"
          >
            Today
          </Link>
          <Link
            href={`${base}?date=${shiftDate(date, 1)}`}
            className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted"
          >
            Next →
          </Link>
        </div>
        <p className="text-sm font-medium">
          {formatDate(from, timeZone, "en-US", { weekday: "long", month: "long", day: "numeric" })}
        </p>
      </div>

      <Card>
        <CardContent className="p-0">
          {appointments.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-muted-foreground">
              No appointments for this day.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {appointments.map((appointment) => (
                <li key={appointment.id} className="flex flex-wrap items-center gap-4 px-4 py-3">
                  <div className="w-28 font-mono text-sm tabular-nums">
                    {formatDateTime(appointment.startAt, timeZone, "en-US")}
                  </div>
                  <div className="min-w-48 flex-1">
                    <p className="text-sm font-medium">
                      {appointment.customerName}
                      {appointment.assetName ? (
                        <span className="text-muted-foreground"> · {appointment.assetName}</span>
                      ) : null}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {appointment.reason}
                      {locations.length > 1
                        ? ` · ${locationNames.get(appointment.locationId) ?? ""}`
                        : ""}
                      {appointment.workOrderId ? " · work order created" : ""}
                    </p>
                  </div>
                  <StatusBadge
                    tone={
                      appointment.status === "COMPLETED"
                        ? "ready"
                        : appointment.status === "CANCELLED" || appointment.status === "NO_SHOW"
                          ? "attention"
                          : appointment.status === "CHECKED_IN"
                            ? "waiting"
                            : "neutral"
                    }
                  >
                    {appointment.status.replace(/_/g, " ").toLowerCase()}
                  </StatusBadge>
                  <AppointmentActions
                    appointmentId={appointment.id}
                    status={appointment.status}
                    workOrderId={appointment.workOrderId}
                    canWrite={canWrite}
                  />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
