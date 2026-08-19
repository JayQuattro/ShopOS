import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/shopos/page-header";
import { db } from "@/db/client";
import { formatDate } from "@/i18n/formatters";
import { getRequestContext } from "@/modules/tenancy/request-context";

export const dynamic = "force-dynamic";

/**
 * The tech's phone screen: their jobs for the day with big touch targets —
 * stage/bay, promise time, concern, open tasks, and the running timer.
 * Desktop-friendly, phone-first; the full work order stays one tap away.
 */
export default async function MyDayPage({ params }: { params: Promise<{ organization: string }> }) {
  const { organization } = await params;
  const context = await getRequestContext(organization);
  if (context.organizationId !== organization) {
    return <p className="text-destructive">Organization context mismatch.</p>;
  }

  const running = await db.timeEntry.findFirst({
    where: { organizationId: context.organizationId, userId: context.actorId, endedAt: null },
    select: { workOrder: { select: { id: true, number: true } } },
  });

  const rows = await db.workOrder.findMany({
    where: {
      organizationId: context.organizationId,
      assignedTechnicianUserId: context.actorId,
      status: { in: ["AUTHORIZED", "IN_PROGRESS", "BLOCKED"] },
      ...(context.organizationWideLocationAccess
        ? {}
        : { locationId: { in: [...context.allowedLocationIds] } }),
    },
    orderBy: { promisedAt: { sort: "asc", nulls: "last" } },
    take: 25,
    select: {
      id: true,
      number: true,
      status: true,
      vehicleStage: true,
      boardStage: { select: { label: true } },
      bayLabel: true,
      promisedAt: true,
      customerConcern: true,
      customer: { select: { displayName: true } },
      asset: { select: { displayName: true } },
      tasks: { where: { status: "OPEN" }, select: { id: true, title: true } },
    },
  });
  const jobs = rows.map((row) => ({
    ...row,
    promisedAt: row.promisedAt?.toISOString() ?? null,
    openTasks: row.tasks,
  }));

  const orgId = context.organizationId;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="My day"
        description="Your jobs, your timer — phone-friendly."
        breadcrumbs={[{ label: "My day" }]}
      />

      {running ? (
        <Card className="border-primary/50">
          <CardContent className="flex flex-wrap items-center justify-between gap-2 py-4">
            <span className="text-sm font-medium">
              ⏱ Timer running on{" "}
              <a
                href={`/app/${orgId}/work-orders/${running.workOrder.id}`}
                className="font-mono text-link underline-offset-4 hover:underline"
              >
                {running.workOrder.number}
              </a>
            </span>
            <a
              href={`/app/${orgId}/work-orders/${running.workOrder.id}`}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
            >
              Open & stop
            </a>
          </CardContent>
        </Card>
      ) : null}

      {jobs.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-sm text-muted-foreground">
              No jobs assigned to you right now — enjoy the quiet.
            </p>
          </CardContent>
        </Card>
      ) : (
        jobs.map((job) => (
          <Card key={job.id}>
            <CardContent className="flex flex-col gap-2 py-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <a
                  href={`/app/${orgId}/work-orders/${job.id}`}
                  className="font-mono text-base font-semibold underline-offset-4 hover:underline"
                >
                  {job.number}
                </a>
                <div className="flex flex-wrap gap-1">
                  {job.boardStage ? (
                    <Badge className="text-[10px]">{job.boardStage.label}</Badge>
                  ) : job.vehicleStage ? (
                    <Badge variant="secondary" className="text-[10px]">
                      {job.vehicleStage.replace(/_/g, " ").toLowerCase()}
                    </Badge>
                  ) : null}
                  {job.bayLabel ? (
                    <Badge variant="outline" className="text-[10px]">
                      {job.bayLabel}
                    </Badge>
                  ) : null}
                </div>
              </div>
              <p className="text-sm font-medium">{job.customer.displayName}</p>
              {job.asset ? (
                <p className="text-sm text-muted-foreground">{job.asset.displayName}</p>
              ) : null}
              <p className="text-sm">{job.customerConcern}</p>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>
                  {job.promisedAt
                    ? `promised ${formatDate(job.promisedAt, "UTC", "en-US")}`
                    : "no promise time"}
                  {job.openTasks.length > 0
                    ? ` · ${job.openTasks.length} open task${job.openTasks.length === 1 ? "" : "s"}`
                    : ""}
                </span>
                <a
                  href={`/app/${orgId}/work-orders/${job.id}`}
                  className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted"
                >
                  Open job →
                </a>
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
