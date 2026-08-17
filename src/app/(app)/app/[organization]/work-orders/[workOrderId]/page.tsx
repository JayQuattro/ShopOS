import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/shopos/status-badge";
import { PageHeader } from "@/components/shopos/page-header";
import { db } from "@/db/client";
import { formatDateTime, formatMoney } from "@/i18n/formatters";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { listAssignableTechnicians } from "@/modules/work-orders/assignment-service";
import { AssignmentSelect } from "./assignment-select";
import { EstimatePanel } from "./estimate-panel";
import { InvoicePanel } from "./invoice-panel";
import { WorkOrderEditForm } from "./work-order-edit-form";
import { StatusTransitionPanel } from "./status-transition-panel";
import { AttachmentPanel } from "./attachment-panel";
import { TimePanel } from "./time-panel";
import { TaskPanel } from "./task-panel";
import { PartsPanel } from "./parts-panel";
import { TrackerLinkCard } from "./tracker-link-card";

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
        take: 10,
        select: {
          id: true,
          revisionNumber: true,
          status: true,
          documentKind: true,
          changeOrderNumber: true,
          summaryNote: true,
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

  const technicians = wo ? await listAssignableTechnicians({ db, context }) : [];

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
            <p className="font-medium">{wo.asset?.displayName ?? "No asset assigned"}</p>
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
            <p className="text-xs text-muted-foreground">Technician</p>
            <AssignmentSelect
              workOrderId={wo.id}
              technicians={technicians}
              assignedUserId={wo.assignedTechnicianUserId}
              canWrite={context.permissions.has("work_orders.write")}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Status actions</CardTitle>
        </CardHeader>
        <CardContent>
          <StatusTransitionPanel
            workOrderId={wo.id}
            currentStatus={wo.status}
            canWrite={context.permissions.has("work_orders.write")}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Customer concern</CardTitle>
        </CardHeader>
        <CardContent>
          <WorkOrderEditForm
            workOrderId={wo.id}
            initialConcern={wo.customerConcern}
            canWrite={context.permissions.has("work_orders.write")}
          />
        </CardContent>
      </Card>

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
            workOrderStatus={wo.status}
            canWrite={context.permissions.has("work_orders.write")}
            canRecordDecisions={context.permissions.has("authorizations.record")}
            revisions={wo.estimateRevisions.map((rev) => ({
              id: rev.id,
              revisionNumber: rev.revisionNumber,
              status: rev.status,
              documentKind: rev.documentKind,
              changeOrderNumber: rev.changeOrderNumber,
              summaryNote: rev.summaryNote,
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

      <AttachmentPanel
        workOrderId={wo.id}
        canWrite={context.permissions.has("work_orders.write")}
      />

      <TimePanel
        workOrderId={wo.id}
        timeZone={wo.location?.timeZone ?? "UTC"}
        technicians={technicians}
        canWrite={context.permissions.has("work_orders.write")}
      />

      <TaskPanel
        workOrderId={wo.id}
        workOrderStatus={wo.status}
        canWrite={context.permissions.has("work_orders.write")}
      />

      <PartsPanel workOrderId={wo.id} canWrite={context.permissions.has("work_orders.write")} />

      <TrackerLinkCard
        workOrderId={wo.id}
        canWrite={context.permissions.has("work_orders.write")}
      />

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
