import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shopos/page-header";
import { EmptyState, SummaryCard } from "@/components/shopos/states";
import { db } from "@/db/client";
import { formatMoney } from "@/i18n/formatters";
import { getRequestContext } from "@/modules/tenancy/request-context";
import {
  businessSummary,
  estimateFunnel,
  revenueTrend,
  statusBreakdown,
  technicianProductivity,
  topJobs,
  workMix,
} from "@/modules/reports/report-service";

export const dynamic = "force-dynamic";

const PERIODS: ReadonlyArray<{ key: string; label: string; days: number; bucket: "day" | "week" }> =
  [
    { key: "7d", label: "Last 7 days", days: 7, bucket: "day" },
    { key: "30d", label: "Last 30 days", days: 30, bucket: "week" },
    { key: "90d", label: "Last 90 days", days: 90, bucket: "week" },
  ];

const bucketLabel = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

function pct(value: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((value / total) * 100);
}

/**
 * Shop reports: money trend, work mix, estimate conversion, pipeline, and
 * technician productivity over a selectable window. Pure reads over the
 * operational data the shop already produces.
 */
export default async function ReportsPage({
  params,
  searchParams,
}: {
  params: Promise<{ organization: string }>;
  searchParams: Promise<{ period?: string }>;
}) {
  const { organization } = await params;
  const { period: periodParam } = await searchParams;
  const context = await getRequestContext(organization);
  if (context.organizationId !== organization) {
    return <p className="text-destructive">Organization context mismatch.</p>;
  }

  const period = PERIODS.find((p) => p.key === periodParam) ?? PERIODS[1]!;
  const to = new Date();
  const from = new Date(to.getTime() - period.days * 24 * 60 * 60 * 1000);

  const [summary, technicians, pipeline, trend, mix, funnel, jobs] = await Promise.all([
    businessSummary({ db, context, from, to }),
    technicianProductivity({ db, context, from, to }),
    statusBreakdown({ db, context }),
    revenueTrend({ db, context, from, to, bucket: period.bucket }),
    workMix({ db, context, from, to }),
    estimateFunnel({ db, context, from, to }),
    topJobs({ db, context, from, to, limit: 5 }),
  ]);

  const currency = summary.invoicedCurrency;
  const money = (minor: number) => formatMoney(minor, currency, "en-US");
  const recoveryRate =
    summary.declinedCount > 0
      ? Math.round((summary.declinedRecoveredCount / summary.declinedCount) * 100)
      : null;
  const trendMax = Math.max(
    1,
    ...trend.map((bucket) => Math.max(bucket.invoicedMinor, bucket.collectedMinor)),
  );
  const trendHasData = trend.some(
    (bucket) => bucket.invoicedMinor > 0 || bucket.collectedMinor > 0,
  );
  const mixTotal = mix.laborMinor + mix.partsMinor + mix.feesMinor;
  const funnelDecided = funnel.approvedMinor + funnel.declinedMinor;
  const approvalRate = funnelDecided > 0 ? pct(funnel.approvedMinor, funnelDecided) : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Reports"
        description="How the shop is doing."
        breadcrumbs={[{ label: "Reports" }]}
      />

      <div className="flex gap-2">
        {PERIODS.map((option) => (
          <Link
            key={option.key}
            href={`/app/${context.organizationId}/reports?period=${option.key}`}
            className={`min-h-11 rounded-md border px-3 py-1.5 text-sm transition-colors ${
              option.key === period.key
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:bg-muted"
            }`}
          >
            {option.label}
          </Link>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="Invoiced" value={money(summary.invoicedMinor)} />
        <SummaryCard label="Collected" value={money(summary.paidMinor)} />
        <SummaryCard label="Outstanding" value={money(summary.outstandingMinor)} />
        <SummaryCard label="Avg. repair order" value={money(summary.averageRepairOrderMinor)} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="Work orders" value={String(summary.workOrderCount)} />
        <SummaryCard
          label="Declined work"
          value={`${summary.declinedCount} · ${money(summary.declinedMinor)}`}
        />
        <SummaryCard
          label="Declined recovered"
          value={
            recoveryRate === null
              ? "—"
              : `${summary.declinedRecoveredCount} (${recoveryRate}%) · ${money(summary.declinedRecoveredMinor)}`
          }
        />
        <SummaryCard
          label="Open pipeline"
          value={String(pipeline.reduce((s, r) => s + r.count, 0))}
        />
      </div>

      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle className="text-base">Money over time</CardTitle>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm bg-primary" aria-hidden="true" />
              Invoiced
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm bg-accent" aria-hidden="true" />
              Collected
            </span>
          </div>
        </CardHeader>
        <CardContent>
          {trendHasData ? (
            <>
              <div
                className="relative h-44"
                role="img"
                aria-label={`Invoiced and collected money per ${period.bucket}, ${period.label.toLowerCase()}`}
              >
                {[100, 75, 50, 25].map((line) => (
                  <div
                    key={line}
                    className="absolute inset-x-0 border-t border-border/60"
                    style={{ top: `${100 - line}%` }}
                    aria-hidden="true"
                  />
                ))}
                <div className="absolute inset-0 flex items-end gap-1.5 sm:gap-2">
                  {trend.map((bucket) => (
                    <div
                      key={bucket.start.toISOString()}
                      className="flex h-full min-w-0 flex-1 items-end justify-center gap-[3px]"
                      title={`${bucketLabel.format(bucket.start)} · Invoiced ${money(bucket.invoicedMinor)} · Collected ${money(bucket.collectedMinor)}`}
                    >
                      <div
                        className="w-full max-w-3.5 rounded-t-sm bg-primary"
                        style={{
                          height: `${Math.round((bucket.invoicedMinor / trendMax) * 100)}%`,
                        }}
                      />
                      <div
                        className="w-full max-w-3.5 rounded-t-sm bg-accent"
                        style={{
                          height: `${Math.round((bucket.collectedMinor / trendMax) * 100)}%`,
                        }}
                      />
                    </div>
                  ))}
                </div>
              </div>
              <div className="mt-2 flex justify-between text-xs text-muted-foreground">
                <span>{bucketLabel.format(trend[0]!.start)}</span>
                <span>{bucketLabel.format(trend[Math.floor(trend.length / 2)]!.start)}</span>
                <span>{bucketLabel.format(trend[trend.length - 1]!.start)}</span>
              </div>
            </>
          ) : (
            <EmptyState
              title="No invoiced work in this period"
              description="Invoiced and collected money will chart here once invoices are issued."
            />
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Work mix</CardTitle>
          </CardHeader>
          <CardContent>
            {mixTotal > 0 ? (
              <>
                <div className="flex h-3 overflow-hidden rounded-full bg-muted">
                  <div
                    className="bg-primary"
                    style={{ width: `${pct(mix.laborMinor, mixTotal)}%` }}
                  />
                  <div
                    className="bg-accent"
                    style={{ width: `${pct(mix.partsMinor, mixTotal)}%` }}
                  />
                  <div
                    className="bg-muted-foreground/50"
                    style={{ width: `${pct(mix.feesMinor, mixTotal)}%` }}
                  />
                </div>
                <ul className="mt-4 flex flex-col gap-2 text-sm">
                  {[
                    { label: "Labor", minor: mix.laborMinor, swatch: "bg-primary" },
                    { label: "Parts", minor: mix.partsMinor, swatch: "bg-accent" },
                    { label: "Fees", minor: mix.feesMinor, swatch: "bg-muted-foreground/50" },
                  ].map((row) => (
                    <li key={row.label} className="flex items-center justify-between">
                      <span className="flex items-center gap-2">
                        <span className={`size-2.5 rounded-sm ${row.swatch}`} aria-hidden="true" />
                        {row.label}
                        <span className="text-xs text-muted-foreground">
                          {pct(row.minor, mixTotal)}%
                        </span>
                      </span>
                      <span className="font-mono tabular-nums">{money(row.minor)}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <EmptyState
                title="Nothing invoiced yet"
                description="The labor / parts / fees split appears once invoices are issued."
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex items-center justify-between">
            <CardTitle className="text-base">Estimate conversion</CardTitle>
            {approvalRate !== null ? (
              <Badge variant="outline">{approvalRate}% approved</Badge>
            ) : null}
          </CardHeader>
          <CardContent>
            {funnel.presentedCount > 0 ? (
              <>
                <p className="text-sm text-muted-foreground">
                  {funnel.presentedCount} estimate{funnel.presentedCount === 1 ? "" : "s"} ·{" "}
                  {money(funnel.presentedMinor)} presented
                </p>
                <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-muted">
                  <div
                    className="bg-primary"
                    style={{ width: `${pct(funnel.approvedMinor, funnel.presentedMinor)}%` }}
                  />
                  <div
                    className="bg-destructive/70"
                    style={{ width: `${pct(funnel.declinedMinor, funnel.presentedMinor)}%` }}
                  />
                  <div
                    className="bg-muted-foreground/40"
                    style={{ width: `${pct(funnel.pendingMinor, funnel.presentedMinor)}%` }}
                  />
                </div>
                <ul className="mt-4 flex flex-col gap-2 text-sm">
                  {[
                    { label: "Approved", minor: funnel.approvedMinor, swatch: "bg-primary" },
                    {
                      label: "Declined",
                      minor: funnel.declinedMinor,
                      swatch: "bg-destructive/70",
                    },
                    {
                      label: "Awaiting decision",
                      minor: funnel.pendingMinor,
                      swatch: "bg-muted-foreground/40",
                    },
                  ].map((row) => (
                    <li key={row.label} className="flex items-center justify-between">
                      <span className="flex items-center gap-2">
                        <span className={`size-2.5 rounded-sm ${row.swatch}`} aria-hidden="true" />
                        {row.label}
                      </span>
                      <span className="font-mono tabular-nums">{money(row.minor)}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <EmptyState
                title="No estimates presented"
                description="Presented estimates and how they convert will show here."
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top jobs</CardTitle>
          </CardHeader>
          <CardContent>
            {jobs.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {jobs.map((job, index) => (
                  <li key={job.label} className="flex items-center justify-between gap-2 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="w-4 shrink-0 text-right text-xs text-muted-foreground">
                        {index + 1}
                      </span>
                      <span className="truncate">{job.label}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {job.invoiceCount} invoice{job.invoiceCount === 1 ? "" : "s"}
                      </span>
                      <span className="font-mono tabular-nums">{money(job.minor)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                title="No invoiced jobs yet"
                description="Job groups from invoiced work will rank here."
              />
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pipeline by status</CardTitle>
          </CardHeader>
          <CardContent>
            {pipeline.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing in progress.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {pipeline.map((row) => (
                  <li key={row.status} className="flex items-center justify-between text-sm">
                    <span className="capitalize">
                      {row.status.replace(/_/g, " ").toLowerCase()}
                    </span>
                    <span className="font-mono tabular-nums">{row.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Technician productivity</CardTitle>
          </CardHeader>
          <CardContent>
            {technicians.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No assignments or time in this period.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">Technician</th>
                    <th className="py-2 pr-4 font-medium text-right">Jobs</th>
                    <th className="py-2 pr-4 font-medium text-right">Time on clock</th>
                    <th className="py-2 pr-4 font-medium text-right">Findings flagged</th>
                    <th className="py-2 font-medium text-right">QC passed</th>
                  </tr>
                </thead>
                <tbody>
                  {technicians.map((tech) => (
                    <tr key={tech.userId} className="border-b border-border/60">
                      <td className="py-2 pr-4">
                        {tech.displayName}
                        {tech.userId === context.actorId ? (
                          <Badge variant="outline" className="ml-2 text-[10px]">
                            you
                          </Badge>
                        ) : null}
                      </td>
                      <td className="py-2 pr-4 text-right font-mono tabular-nums">
                        {tech.workOrdersAssigned}
                      </td>
                      <td className="py-2 pr-4 text-right font-mono tabular-nums">
                        {Math.floor(tech.loggedMinutes / 60)}h {tech.loggedMinutes % 60}m
                      </td>
                      <td className="py-2 pr-4 text-right font-mono tabular-nums">
                        {tech.flaggedFindings}
                      </td>
                      <td className="py-2 text-right font-mono tabular-nums">
                        {tech.qualityChecksPassed}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
