import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WorkOrderStatusBadge } from "@/components/shopos/status-badge";
import { RecordList, RecordListRow } from "@/components/shopos/record-list";
import { WorkOrderTabs } from "./work-order-tabs";
import { humanizeToken } from "@/lib/labels";
import { db } from "@/db/client";
import { formatDateTime, formatMoney } from "@/i18n/formatters";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { listAssignableTechnicians } from "@/modules/work-orders/assignment-service";
import { listLoanerCandidates } from "@/modules/assets/fleet-service";
import { WorkOrderHeader } from "./work-order-header";
import { AssignmentSelect } from "./[workOrderId]/assignment-select";
import { VehicleCard } from "./[workOrderId]/vehicle-card";
import { BoardStageSelect } from "./[workOrderId]/board-stage-select";
import { EstimatePanel } from "./[workOrderId]/estimate-panel";
import { InvoicePanel } from "./[workOrderId]/invoice-panel";
import { WorkOrderEditForm } from "./[workOrderId]/work-order-edit-form";
import { StatusTransitionPanel } from "./[workOrderId]/status-transition-panel";
import { AttachmentPanel } from "./[workOrderId]/attachment-panel";
import { TimePanel } from "./[workOrderId]/time-panel";
import { TaskPanel } from "./[workOrderId]/task-panel";
import { QualityCheckCard } from "./[workOrderId]/quality-check-card";
import { PartsPanel } from "./[workOrderId]/parts-panel";
import { LoanerPanel } from "./[workOrderId]/loaner-panel";
import { SubletPanel } from "./[workOrderId]/sublet-panel";
import { DepositPanel } from "./[workOrderId]/deposit-panel";
import { InspectionPanel } from "./[workOrderId]/inspection-panel";
import { TrackerLinkCard } from "./[workOrderId]/tracker-link-card";
import { ApplyTemplateCard } from "./[workOrderId]/apply-template-card";

/**
 * Shared data every open work-order pane needs. Loaded once per page and
 * passed to each pane (the workspace renders several at once).
 */
export async function loadWorkOrderSharedData(
  context: Awaited<ReturnType<typeof getRequestContext>>,
): Promise<WorkOrderSharedData> {
  const [technicians, boardStages, inspectionTemplates] = await Promise.all([
    listAssignableTechnicians({ db, context }),
    db.boardStage.findMany({
      where: { organizationId: context.organizationId, active: true },
      orderBy: { sortOrder: "asc" },
      select: { id: true, label: true },
    }),
    db.inspectionTemplate.findMany({
      where: { organizationId: context.organizationId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);
  return { technicians, boardStages, inspectionTemplates };
}

export type WorkOrderSharedData = Readonly<{
  technicians: Awaited<ReturnType<typeof listAssignableTechnicians>>;
  boardStages: ReadonlyArray<{ id: string; label: string }>;
  inspectionTemplates: ReadonlyArray<{ id: string; name: string }>;
}>;

/**
 * The full work-order detail view — sections, jump nav, and every panel.
 * Rendered by the detail route and once per tab in the workspace.
 * Returns null when the work order does not exist in this tenant.
 */
export async function WorkOrderDetailPane({
  context,
  workOrderId,
  shared,
}: {
  context: Awaited<ReturnType<typeof getRequestContext>>;
  workOrderId: string;
  shared?: WorkOrderSharedData;
}) {
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

  const sharedData = shared ?? (await loadWorkOrderSharedData(context));
  const { technicians, boardStages, inspectionTemplates } = sharedData;
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

  // Loaner candidates: fleet vehicles when the shop has marked any; otherwise
  // the heuristic fallback (active assets not tied to this WO's customer).
  const loanerAssets = wo
    ? await listLoanerCandidates({ db, context, excludeCustomerId: wo.customer.id })
    : [];

  if (!wo) return null;

  // Authorized so far: the total of estimate lines with an APPROVED decision.
  const approvedSum = await db.estimateLine.aggregate({
    _sum: { totalMinor: true },
    where: {
      organizationId: context.organizationId,
      revision: { workOrderId: wo.id },
      authorizationDecisions: { some: { decision: "APPROVED" } },
    },
  });
  const authorizedMinor = approvedSum._sum.totalMinor ?? 0n;

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href={`/app/${context.organizationId}/work-orders`}>
              Work orders
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{wo.number}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <WorkOrderHeader
        number={wo.number}
        organizationId={context.organizationId}
        statusBadge={<WorkOrderStatusBadge status={wo.status} />}
        customerId={wo.customer.id}
        customerName={wo.customer.displayName}
        vehicleName={wo.asset?.displayName ?? null}
        locationName={wo.location?.name ?? null}
        estimateMinor={wo.estimateRevisions[0]?.totalMinor ?? null}
        authorizedMinor={authorizedMinor}
        invoiceMinor={wo.invoice ? wo.invoice.totalMinor : null}
        paidMinor={wo.invoice ? wo.invoice.paidMinor : null}
        currency={wo.estimateRevisions[0]?.currency ?? wo.invoice?.currency ?? "USD"}
      >
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
            <p className="text-xs text-muted-foreground">Board column</p>
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
            <div className="mt-3 flex flex-wrap gap-3 border-t border-border pt-3 text-sm">
              <a
                href={`/print/${context.organizationId}/repair-order/${wo.id}`}
                target="_blank"
                rel="noreferrer"
                className="text-link underline-offset-4 hover:underline"
              >
                Print RO
              </a>
              <a
                href={`/print/${context.organizationId}/authorization/${wo.id}`}
                target="_blank"
                rel="noreferrer"
                className="text-link underline-offset-4 hover:underline"
              >
                Print authorization
              </a>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Status</CardTitle>
          </CardHeader>
          <CardContent>
            <StatusTransitionPanel
              workOrderId={wo.id}
              currentStatus={wo.status}
              canWrite={context.permissions.has("work_orders.write")}
            />
          </CardContent>
        </Card>
      </WorkOrderHeader>

      <WorkOrderTabs
        tabs={[
          {
            id: "jobs",
            label: "Jobs & estimate",
            content: (
              <>
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
              </>
            ),
          },
          {
            id: "parts",
            label: "Parts",
            content: (
              <>
                <PartsPanel
                  workOrderId={wo.id}
                  canWrite={context.permissions.has("work_orders.write")}
                />
                <SubletPanel
                  workOrderId={wo.id}
                  canWrite={context.permissions.has("work_orders.write")}
                />
              </>
            ),
          },
          {
            id: "work",
            label: "Work & time",
            content: (
              <>
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
              </>
            ),
          },
          {
            id: "inspections",
            label: "Inspections & media",
            content: (
              <>
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
              </>
            ),
          },
          {
            id: "money",
            label: "Money",
            content: (
              <>
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
                                <Badge
                                  variant={rev.status === "PRESENTED" ? "default" : "secondary"}
                                >
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
              </>
            ),
          },
          {
            id: "activity",
            label: "Activity",
            content: (
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
            ),
          },
        ]}
      />
    </div>
  );
}
