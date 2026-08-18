import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shopos/page-header";
import { SummaryCard } from "@/components/shopos/states";
import { db } from "@/db/client";
import { formatMoney } from "@/i18n/formatters";
import { getRequestContext } from "@/modules/tenancy/request-context";
import {
  businessSummary,
  statusBreakdown,
  technicianProductivity,
} from "@/modules/reports/report-service";

export const dynamic = "force-dynamic";

const PERIODS: ReadonlyArray<{ key: string; label: string; days: number }> = [
  { key: "7d", label: "Last 7 days", days: 7 },
  { key: "30d", label: "Last 30 days", days: 30 },
  { key: "90d", label: "Last 90 days", days: 90 },
];

/**
 * Shop reports: business summary, declined-work recovery, pipeline, and
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

  const [summary, technicians, pipeline] = await Promise.all([
    businessSummary({ db, context, from, to }),
    technicianProductivity({ db, context, from, to }),
    statusBreakdown({ db, context }),
  ]);

  const currency = summary.invoicedCurrency;
  const money = (minor: number) => formatMoney(minor, currency, "en-US");
  const recoveryRate =
    summary.declinedCount > 0
      ? Math.round((summary.declinedRecoveredCount / summary.declinedCount) * 100)
      : null;

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
            className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
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
