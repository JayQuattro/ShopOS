import { PageHeader } from "@/components/shopos/page-header";
import { EmptyState } from "@/components/shopos/states";
import { db } from "@/db/client";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { loadWorkOrderSharedData, WorkOrderDetailPane } from "../work-order-pane";
import { WorkspaceShell } from "./workspace-shell";

export const dynamic = "force-dynamic";

/**
 * Tabbed work-order workspace: several ROs open at once, each keeping its
 * own scroll and panel state. The open set lives in the URL
 * (`?wo=id1,id2&active=id2`), so a refresh restores it exactly.
 */
export default async function WorkOrderWorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ organization: string }>;
  searchParams: Promise<{ wo?: string; active?: string }>;
}) {
  const { organization } = await params;
  const { wo, active } = await searchParams;
  const context = await getRequestContext(organization);
  if (context.organizationId !== organization) {
    return <p className="text-destructive">Organization context mismatch.</p>;
  }

  const requestedIds = [
    ...new Set(
      (wo ?? "")
        .split(",")
        .map((id) => id.trim())
        .filter((id) => id.length > 0),
    ),
  ].slice(0, 6);

  if (requestedIds.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Workspace"
          description="Several work orders open at once — switch without losing your place."
          breadcrumbs={[
            { label: "Work orders", href: `/app/${context.organizationId}/work-orders` },
            { label: "Workspace" },
          ]}
        />
        <EmptyState
          title="No work orders open"
          description='Open one from the work order list, or use "Open in workspace" on any work order.'
        />
      </div>
    );
  }

  // Resolve labels (and drop unknown/cross-tenant ids) before rendering panes.
  const rows = await db.workOrder.findMany({
    where: {
      organizationId: context.organizationId,
      id: { in: requestedIds },
      ...(context.organizationWideLocationAccess
        ? {}
        : { locationId: { in: [...context.allowedLocationIds] } }),
    },
    select: { id: true, number: true },
  });
  const byRequested = new Map(rows.map((row) => [row.id, row]));
  // Preserve the URL order (most recently opened last), drop unknown ids.
  const open = requestedIds
    .map((id) => byRequested.get(id))
    .filter((row): row is { id: string; number: string } => row !== undefined);

  const shared = await loadWorkOrderSharedData(context);
  const tabs = await Promise.all(
    open.map(async (row) => ({
      id: row.id,
      label: `RO ${row.number}`,
      node: await WorkOrderDetailPane({
        context,
        workOrderId: row.id,
        shared,
      }),
    })),
  );
  const renderable = tabs.filter((tab) => tab.node !== null);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Workspace"
        description="Several work orders open at once — switch without losing your place."
        breadcrumbs={[
          { label: "Work orders", href: `/app/${context.organizationId}/work-orders` },
          { label: "Workspace" },
        ]}
      />
      <WorkspaceShell
        organizationId={context.organizationId}
        tabs={renderable}
        initialActiveId={active ?? renderable[renderable.length - 1]?.id ?? null}
      />
    </div>
  );
}
