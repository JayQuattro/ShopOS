import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/shopos/status-badge";
import { PageHeader } from "@/components/shopos/page-header";
import { db } from "@/db/client";
import { formatDateTime, formatMoney } from "@/i18n/formatters";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { EstimatePanel } from "./estimate-panel";
import { InvoicePanel } from "./invoice-panel";

export default async function WorkOrderDetailPage({
  params,
}: {
  params: Promise<{ organization: string; workOrderId: string }>;
}) {
  const context = await getRequestContext();
  const { organization, workOrderId } = await params;
  if (context.organizationId !== organization) {
    return <p className="text-destructive">Organization context mismatch.</p>;
  }

  const wo = await db.workOrder.findFirst({
    where: {
      id: workOrderId,
      organizationId: context.organizationId,
      ...(context.organizationWideLocationAccess
        ? {}
        : { locationId: { in: [...context.allowedLocationIds] } }),
    },
    include: {
      customer: { select: { id: true, displayName: true } },
      asset: { select: { id: true, displayName: true } },
      location: { select: { id: true, name: true, timeZone: true } },
      estimateRevisions: {
        orderBy: { revisionNumber: "desc" },
        take: 5,
        select: {
          id: true,
          revisionNumber: true,
          status: true,
          currency: true,
          totalMinor: true,
          presentedAt: true,
        },
      },
      activityEvents: {
        orderBy: { occurredAt: "desc" },
        take: 20,
        select: { id: true, eventType: true, summary: true, occurredAt: true },
      },
      invoice: {
        select: {
          id: true,
          number: true,
          status: true,
          totalMinor: true,
          paidMinor: true,
          currency: true,
        },
      },
    },
  });

  if (!wo) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-sm text-muted-foreground">Work order not found.</p>
          <Link
            href={`/app/${context.organizationId}/work-orders`}
            className="text-link underline-offset-4 hover:underline"
          >
            ← Back to work orders
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={wo.number}
        description={wo.customerConcern}
        breadcrumbs={[
          { label: "Work orders", href: `/app/${context.organizationId}/work-orders` },
          { label: wo.number },
        ]}
        actions={
          <StatusBadge
            tone={
              wo.status === "COMPLETED" || wo.status === "CLOSED"
                ? "ready"
                : wo.status === "IN_PROGRESS"
                  ? "waiting"
                  : wo.status === "BLOCKED"
                    ? "attention"
                    : "neutral"
            }
          >
            {wo.status.replace(/_/g, " ").toLowerCase()}
          </StatusBadge>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="py-4">
            <p className="text-xs text-muted-foreground">Customer</p>
            <Link
              href={`/app/${context.organizationId}/customers/${wo.customer.id}`}
              className="font-medium text-link underline-offset-4 hover:underline"
            >
              {wo.customer.displayName}
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-xs text-muted-foreground">Asset</p>
            <p className="font-medium">{wo.asset.displayName}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-xs text-muted-foreground">Location</p>
            <p className="font-medium">{wo.location?.name ?? "—"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-xs text-muted-foreground">Type</p>
            <p className="font-medium capitalize">{wo.workType.toLowerCase()}</p>
          </CardContent>
        </Card>
      </div>

      {wo.estimateRevisions.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Estimate revisions</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Rev</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium">Total</th>
                  <th className="py-2 pr-4 font-medium">Presented</th>
                </tr>
              </thead>
              <tbody>
                {wo.estimateRevisions.map((rev) => (
                  <tr key={rev.id} className="border-b border-border/60">
                    <td className="py-3 pr-4 font-mono">#{rev.revisionNumber}</td>
                    <td className="py-3 pr-4">
                      <Badge variant={rev.status === "PRESENTED" ? "default" : "secondary"}>
                        {rev.status.toLowerCase()}
                      </Badge>
                    </td>
                    <td className="py-3 pr-4 font-mono tabular-nums">
                      {formatMoney(Number(rev.totalMinor), rev.currency, "en-US")}
                    </td>
                    <td className="py-3 pr-4 text-muted-foreground">
                      {rev.presentedAt ? formatDateTime(rev.presentedAt, "UTC", "en-US") : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Estimate</CardTitle>
        </CardHeader>
        <CardContent>
          <EstimatePanel
            workOrderId={wo.id}
            revisions={wo.estimateRevisions.map((rev) => ({
              id: rev.id,
              revisionNumber: rev.revisionNumber,
              status: rev.status,
              currency: rev.currency,
              totalMinor: rev.totalMinor.toString(),
            }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Invoice</CardTitle>
        </CardHeader>
        <CardContent>
          <InvoicePanel
            workOrderId={wo.id}
            invoice={
              wo.invoice
                ? {
                    id: wo.invoice.id,
                    number: wo.invoice.number,
                    status: wo.invoice.status,
                    totalMinor: wo.invoice.totalMinor.toString(),
                    paidMinor: wo.invoice.paidMinor.toString(),
                    currency: wo.invoice.currency,
                  }
                : {
                    id: null,
                    number: null,
                    status: null,
                    totalMinor: null,
                    paidMinor: null,
                    currency: "USD",
                  }
            }
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="flex flex-col gap-3">
            {wo.activityEvents.map((event) => (
              <li key={event.id} className="flex gap-3">
                <span className="mt-1.5 size-2 shrink-0 rounded-full bg-muted-foreground/40" />
                <div className="flex flex-col">
                  <span className="text-sm">{event.summary}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(event.occurredAt, "UTC", "en-US")}
                  </span>
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
