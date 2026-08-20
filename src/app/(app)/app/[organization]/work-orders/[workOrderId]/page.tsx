import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/shopos/status-badge";
import { PageHeader } from "@/components/shopos/page-header";
import { RecordList, RecordListRow } from "@/components/shopos/record-list";
import { PageSection, SectionNav } from "@/components/shopos/section";
import { humanizeToken } from "@/lib/labels";
import { db } from "@/db/client";
import { formatDateTime, formatMoney } from "@/i18n/formatters";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { listAssignableTechnicians } from "@/modules/work-orders/assignment-service";
import { listLoanerCandidates } from "@/modules/assets/fleet-service";
import { AssignmentSelect } from "./assignment-select";
import { VehicleCard } from "./vehicle-card";
import { BoardStageSelect } from "./board-stage-select";
import { EstimatePanel } from "./estimate-panel";
import { InvoicePanel } from "./invoice-panel";
import { WorkOrderEditForm } from "./work-order-edit-form";
import { StatusTransitionPanel } from "./status-transition-panel";
import { AttachmentPanel } from "./attachment-panel";
import { TimePanel } from "./time-panel";
import { TaskPanel } from "./task-panel";
import { QualityCheckCard } from "./quality-check-card";
import { PartsPanel } from "./parts-panel";
import { LoanerPanel } from "./loaner-panel";
import { SubletPanel } from "./sublet-panel";
import { DepositPanel } from "./deposit-panel";
import { InspectionPanel } from "./inspection-panel";
import { TrackerLinkCard } from "./tracker-link-card";
import { ApplyTemplateCard } from "./apply-template-card";

export default async function WorkOrderDetailPage({
  params,
}: {
  params: Promise<{ organization: string; workOrderId: string }>;
}) {
  const { organization, workOrderId } = await params;
  const context = await getRequestContext(organization);
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
          paymentUrl: true,
        },
      },
      assistingTechnicians: {
        select: { userId: true, user: { select: { displayName: true } } },
      },
    },
  });

  const technicians = wo ? await listAssignableTechnicians({ db, context }) : [];
  const customerAssets = wo
    ? await db.asset.findMany({
        where: {
          organizationId: context.organizationId,
          customerId: wo.customer.id,
          status: { not: "SOLD" },
        },
        select: { id: true, displayName: true, customerId: true },
        orderBy: { displayName: "asc" },
      })
    : [];
  const boardStages = wo
    ? await db.boardStage.findMany({
        where: { organizationId: context.organizationId, active: true },
        orderBy: { sortOrder: "asc" },
        select: { id: true, label: true },
      })
    : [];
  const inspectionTemplates = wo
    ? await db.inspectionTemplate.findMany({
        where: { organizationId: context.organizationId },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      })
    : [];

  // Loaner candidates: fleet vehicles when the shop has marked any; otherwise
  // the heuristic fallback (active assets not tied to this WO's customer).
  const loanerAssets = wo
    ? await listLoanerCandidates({ db, context, excludeCustomerId: wo.customer.id })
    : [];

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
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" asChild>
              <a
                href={`/print/${context.organizationId}/repair-order/${wo.id}`}
                target="_blank"
                rel="noreferrer"
              >
                Print RO
              </a>
            </Button>
            <Button variant="outline" asChild>
              <a
                href={`/print/${context.organizationId}/authorization/${wo.id}`}
                target="_blank"
                rel="noreferrer"
              >
                Print authorization
              </a>
            </Button>
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
              {humanizeToken(wo.status)}
            </StatusBadge>
          </div>
        }
      />

      <SectionNav
        items={[
          { href: "#overview", label: "Overview" },
          { href: "#jobs", label: "Jobs & time" },
          { href: "#parts", label: "Parts" },
          { href: "#money", label: "Money" },
          { href: "#inspections", label: "Inspections & media" },
          { href: "#activity", label: "Activity" },
        ]}
      />

      <PageSection
        id="overview"
        title="Overview"
        description="Who, what vehicle, and where it stands."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Card>
            <CardContent className="py-4">
              <p className="text-xs text-muted-foreground">Customer</p>
              <Link
                href={`/app/${context.organizationId}/customers/${wo.customer.id}`}
                className="font-medium text-link underline-offset-4 hover:underline"
              >
                {wo.customer.displayName}
              </Link>
              <p className="mt-1 text-xs text-muted-foreground">{wo.location?.name ?? "—"}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <p className="text-xs text-muted-foreground">Technician</p>
              <AssignmentSelect
                workOrderId={wo.id}
                technicians={technicians}
                assignedUserId={wo.assignedTechnicianUserId}
                assisting={wo.assistingTechnicians.map((entry) => ({
                  userId: entry.userId,
                  displayName: entry.user.displayName,
                }))}
                canWrite={context.permissions.has("work_orders.write")}
              />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex flex-col gap-3 py-4">
              <VehicleCard
                workOrderId={wo.id}
                locationId={wo.locationId}
                stage={wo.vehicleStage}
                bayLabel={wo.bayLabel}
                currentAssetId={wo.assetId}
                customerAssets={customerAssets.map((asset) => ({
                  id: asset.id,
                  displayName: asset.displayName,
                  customerId: asset.customerId,
                }))}
                canWrite={context.permissions.has("work_orders.write")}
              />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <BoardStageSelect
                workOrderId={wo.id}
                stages={boardStages.map((stage) => ({ id: stage.id, label: stage.label }))}
                currentStageId={wo.boardStageId}
                canWrite={context.permissions.has("work_orders.write")}
              />
              <p className="mt-3 text-xs text-muted-foreground">
                Key: {wo.keyTag ? <span className="font-mono">{wo.keyTag}</span> : "no tag"}
                {wo.keyLocation ? ` · ${wo.keyLocation}` : ""} ·{" "}
                <Link
                  href={`/app/${context.organizationId}/keys`}
                  className="text-link underline-offset-4 hover:underline"
                >
                  key board
                </Link>
              </p>
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
      </PageSection>

      <PageSection
        id="jobs"
        title="Jobs & time"
        description="Tasks, labor time, and quality checks."
      >
        <ApplyTemplateCard
          workOrderId={wo.id}
          canWrite={context.permissions.has("work_orders.write")}
        />
        <TaskPanel
          workOrderId={wo.id}
          workOrderStatus={wo.status}
          canWrite={context.permissions.has("work_orders.write")}
        />
        <TimePanel
          workOrderId={wo.id}
          timeZone={wo.location?.timeZone ?? "UTC"}
          technicians={technicians}
          canWrite={context.permissions.has("work_orders.write")}
        />
        <QualityCheckCard
          workOrderId={wo.id}
          timeZone={wo.location?.timeZone ?? "UTC"}
          canWrite={context.permissions.has("work_orders.write")}
        />
      </PageSection>

      <PageSection id="parts" title="Parts" description="Ordering, receiving, and sublet work.">
        <PartsPanel workOrderId={wo.id} canWrite={context.permissions.has("work_orders.write")} />
        <SubletPanel workOrderId={wo.id} canWrite={context.permissions.has("work_orders.write")} />
      </PageSection>

      <PageSection
        id="money"
        title="Money"
        description="Estimates, authorization, invoice, and deposits."
      >
        {wo.estimateRevisions.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Estimate revisions</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <RecordList>
                {wo.estimateRevisions.map((rev) => (
                  <RecordListRow
                    key={rev.id}
                    title={`Revision #${rev.revisionNumber}${rev.changeOrderNumber ? ` · change order ${rev.changeOrderNumber}` : ""}`}
                    description={
                      rev.presentedAt
                        ? `Presented ${formatDateTime(rev.presentedAt, "UTC", "en-US")}`
                        : "Not presented yet"
                    }
                    trailing={
                      <>
                        <Badge variant={rev.status === "PRESENTED" ? "default" : "secondary"}>
                          {humanizeToken(rev.status)}
                        </Badge>
                        <span className="font-mono text-sm tabular-nums">
                          {formatMoney(Number(rev.totalMinor), rev.currency, "en-US")}
                        </span>
                      </>
                    }
                  />
                ))}
              </RecordList>
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
                      paymentUrl: wo.invoice.paymentUrl,
                      currency: wo.invoice.currency,
                    }
                  : {
                      id: null,
                      number: null,
                      status: null,
                      totalMinor: null,
                      paidMinor: null,
                      paymentUrl: null,
                      currency: "USD",
                    }
              }
            />
          </CardContent>
        </Card>

        <DepositPanel
          orgId={context.organizationId}
          workOrderId={wo.id}
          hasInvoice={wo.invoice !== null}
          canRecordMoney={context.permissions.has("payments.record")}
        />
      </PageSection>

      <PageSection
        id="inspections"
        title="Inspections & media"
        description="Digital vehicle inspections, photos and video, loaners, and the customer tracker."
      >
        <InspectionPanel
          workOrderId={wo.id}
          templates={inspectionTemplates.map((template) => ({
            id: template.id,
            name: template.name,
          }))}
          canWrite={context.permissions.has("work_orders.write")}
        />
        <AttachmentPanel
          workOrderId={wo.id}
          canWrite={context.permissions.has("work_orders.write")}
        />
        <LoanerPanel
          workOrderId={wo.id}
          loanerAssets={loanerAssets.map((asset) => ({
            id: asset.id,
            displayName: asset.displayName,
          }))}
          canWrite={context.permissions.has("work_orders.write")}
          orgId={context.organizationId}
          locationId={wo.locationId}
          customerId={wo.customer.id}
        />
        <TrackerLinkCard
          workOrderId={wo.id}
          canWrite={context.permissions.has("work_orders.write")}
        />
      </PageSection>

      <PageSection
        id="activity"
        title="Activity"
        description="Everything that happened on this job."
      >
        <Card>
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
      </PageSection>
    </div>
  );
}
