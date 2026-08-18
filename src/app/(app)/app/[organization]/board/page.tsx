import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/shopos/page-header";
import { db } from "@/db/client";
import { getRequestContext } from "@/modules/tenancy/request-context";

export const dynamic = "force-dynamic";

const STAGES: ReadonlyArray<{ key: string; label: string; hint: string }> = [
  { key: "WAITING", label: "Checked in — waiting", hint: "Needs a bay" },
  { key: "IN_BAY", label: "In the bay", hint: "Being worked on" },
  { key: "ON_LIFT", label: "On the lift", hint: "" },
  { key: "TEST_DRIVE", label: "Test drive", hint: "" },
  { key: "WAITING_PARTS", label: "Waiting on parts", hint: "" },
  { key: "READY_FOR_PICKUP", label: "Ready for pickup", hint: "Call or text the customer" },
];

type BoardWorkOrder = {
  id: string;
  number: string;
  status: string;
  vehicleStage: string | null;
  bayLabel: string | null;
  customer: { displayName: string };
  asset: { displayName: string } | null;
  assignedTechnician: { displayName: string } | null;
  tasks: Array<{ id: string }>;
  estimateRevisions: Array<{
    id: string;
    lines: Array<{ authorizationDecisions: Array<{ decision: string }> }>;
  }>;
  partOrders: Array<{ id: string }>;
};

function hasPendingDecision(wo: BoardWorkOrder): boolean {
  return wo.estimateRevisions.some((revision) =>
    revision.lines.some((line) => !line.authorizationDecisions[0]),
  );
}

/**
 * The shop floor at a glance: active jobs grouped by physical stage, with
 * technician, bay, flagged findings, and pending-approval chips. Stage moves
 * happen on the work order itself; the board is the wall view.
 */
export default async function WorkBoardPage({
  params,
}: {
  params: Promise<{ organization: string }>;
}) {
  const { organization } = await params;
  const context = await getRequestContext(organization);
  if (context.organizationId !== organization) {
    return <p className="text-destructive">Organization context mismatch.</p>;
  }

  const workOrders: BoardWorkOrder[] = await db.workOrder.findMany({
    where: {
      organizationId: context.organizationId,
      status: { in: ["AUTHORIZED", "IN_PROGRESS", "BLOCKED", "COMPLETED"] },
      vehicleStage: { not: null },
      ...(context.organizationWideLocationAccess
        ? {}
        : { locationId: { in: [...context.allowedLocationIds] } }),
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
    select: {
      id: true,
      number: true,
      status: true,
      vehicleStage: true,
      bayLabel: true,
      customer: { select: { displayName: true } },
      asset: { select: { displayName: true } },
      assignedTechnician: { select: { displayName: true } },
      tasks: { where: { status: "NEEDS_ATTENTION" }, select: { id: true } },
      estimateRevisions: {
        where: { status: "PRESENTED", documentKind: "CHANGE_ORDER" },
        select: {
          id: true,
          lines: {
            select: { authorizationDecisions: { select: { decision: true }, take: 1 } },
          },
        },
      },
      partOrders: { where: { status: { in: ["REQUESTED", "ORDERED"] } }, select: { id: true } },
    },
  });

  const byStage = new Map<string, BoardWorkOrder[]>();
  for (const stage of STAGES) byStage.set(stage.key, []);
  const unstaged: BoardWorkOrder[] = [];
  for (const wo of workOrders) {
    if (wo.vehicleStage && byStage.has(wo.vehicleStage)) {
      byStage.get(wo.vehicleStage)!.push(wo);
    } else if (wo.vehicleStage) {
      unstaged.push(wo);
    }
  }

  const orgId = context.organizationId;
  function card(wo: BoardWorkOrder) {
    return (
      <Link
        key={wo.id}
        href={`/app/${orgId}/work-orders/${wo.id}`}
        className="block rounded-lg border border-border bg-card p-3 transition-colors hover:border-primary/50"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-xs font-medium">{wo.number}</span>
          {wo.bayLabel ? (
            <Badge variant="outline" className="text-[10px]">
              {wo.bayLabel}
            </Badge>
          ) : null}
        </div>
        <p className="mt-1 truncate text-sm font-medium">{wo.customer.displayName}</p>
        <p className="truncate text-xs text-muted-foreground">
          {wo.asset?.displayName ?? "No asset"}
        </p>
        <div className="mt-2 flex flex-wrap gap-1">
          {wo.assignedTechnician ? (
            <Badge variant="secondary" className="text-[10px]">
              {wo.assignedTechnician.displayName}
            </Badge>
          ) : null}
          {hasPendingDecision(wo) ? (
            <Badge variant="destructive" className="text-[10px]">
              needs approval
            </Badge>
          ) : null}
          {wo.partOrders.length > 0 ? (
            <Badge variant="outline" className="text-[10px]">
              parts pending
            </Badge>
          ) : null}
          {wo.tasks.length > 0 ? (
            <Badge variant="outline" className="text-[10px]">
              {wo.tasks.length} flagged
            </Badge>
          ) : null}
          {wo.status === "COMPLETED" ? <Badge className="text-[10px]">done</Badge> : null}
        </div>
      </Link>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Work board"
        description="The shop floor at a glance — jobs by stage."
        breadcrumbs={[{ label: "Work board" }]}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {STAGES.map((stage) => {
          const jobs = byStage.get(stage.key) ?? [];
          return (
            <div key={stage.key} className="flex min-w-0 flex-col gap-2">
              <div className="flex items-baseline justify-between">
                <p className="text-sm font-semibold">{stage.label}</p>
                <span className="font-mono text-xs text-muted-foreground">{jobs.length}</span>
              </div>
              {stage.hint ? (
                <p className="text-[11px] text-muted-foreground">{stage.hint}</p>
              ) : null}
              <div className="flex flex-col gap-2 rounded-lg bg-muted/40 p-2">
                {jobs.length === 0 ? (
                  <p className="px-1 py-3 text-center text-xs text-muted-foreground">Empty</p>
                ) : (
                  jobs.map(card)
                )}
              </div>
            </div>
          );
        })}
      </div>

      {unstaged.length > 0 ? (
        <Card>
          <CardContent className="pt-6">
            <p className="mb-2 text-sm font-semibold">Other stages</p>
            <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-6">{unstaged.map(card)}</div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
