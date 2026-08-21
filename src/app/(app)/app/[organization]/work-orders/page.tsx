import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ListSearch } from "@/components/shopos/list-search";
import { PageHeader } from "@/components/shopos/page-header";
import { RecordList, RecordListRow } from "@/components/shopos/record-list";
import { EmptyState } from "@/components/shopos/states";
import { WorkOrderStatusBadge } from "@/components/shopos/status-badge";
import { humanizeToken } from "@/lib/labels";
import { db } from "@/db/client";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { WorkOrderCreateForm } from "./work-order-create-form";

const STATUSES = [
  "ESTIMATING",
  "AWAITING_AUTHORIZATION",
  "AUTHORIZED",
  "IN_PROGRESS",
  "BLOCKED",
  "COMPLETED",
  "INVOICED",
  "CLOSED",
] as const;
const STATUS_ORDER: Readonly<Record<string, number>> = Object.fromEntries(
  STATUSES.map((status, index) => [status, index]),
);

export default async function WorkOrdersPage({
  params,
  searchParams,
}: {
  params: Promise<{ organization: string }>;
  searchParams: Promise<{ new?: string; customer?: string; q?: string; status?: string }>;
}) {
  const { organization } = await params;
  const {
    new: wantsNew,
    customer: preselectedCustomer,
    q: search,
    status: statusParam,
  } = await searchParams;
  const context = await getRequestContext(organization);
  if (context.organizationId !== organization) {
    return <p className="text-destructive">Organization context mismatch.</p>;
  }

  const query = search?.trim() ?? "";
  const statusFilter =
    statusParam && (STATUSES as readonly string[]).includes(statusParam)
      ? (statusParam as (typeof STATUSES)[number])
      : null;

  const workOrders = await db.workOrder.findMany({
    where: {
      organizationId: context.organizationId,
      ...(context.organizationWideLocationAccess
        ? {}
        : { locationId: { in: [...context.allowedLocationIds] } }),
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(query
        ? {
            OR: [
              { number: { contains: query, mode: "insensitive" } },
              { customer: { displayName: { contains: query, mode: "insensitive" } } },
              { asset: { displayName: { contains: query, mode: "insensitive" } } },
              { customerConcern: { contains: query, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      number: true,
      status: true,
      workType: true,
      customerConcern: true,
      customer: { select: { displayName: true } },
      asset: { select: { displayName: true } },
      createdAt: true,
    },
    take: 100,
  });

  const statusCounts = await db.workOrder.groupBy({
    by: ["status"],
    where: {
      organizationId: context.organizationId,
      ...(context.organizationWideLocationAccess
        ? {}
        : { locationId: { in: [...context.allowedLocationIds] } }),
      status: { notIn: ["CANCELLED"] },
    },
    _count: { status: true },
  });
  const chips = statusCounts
    .map((row) => ({ status: row.status as string, count: row._count.status }))
    .filter((row) => row.status in STATUS_ORDER)
    .sort((a, b) => STATUS_ORDER[a.status]! - STATUS_ORDER[b.status]!);
  const chipHref = (status: string | null) => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (status) params.set("status", status);
    const qs = params.toString();
    return qs
      ? `/app/${context.organizationId}/work-orders?${qs}`
      : `/app/${context.organizationId}/work-orders`;
  };

  // Load customers, assets, and locations for the create form (permission-gated).
  const canCreate = context.permissions.has("work_orders.write");
  const [customers, assets, locations] = canCreate
    ? await Promise.all([
        db.customer.findMany({
          where: { organizationId: context.organizationId, archivedAt: null },
          select: { id: true, displayName: true },
          take: 100,
          orderBy: { displayName: "asc" },
        }),
        db.asset.findMany({
          where: { organizationId: context.organizationId, status: "ACTIVE" },
          select: { id: true, displayName: true, customerId: true },
          take: 100,
          orderBy: { displayName: "asc" },
        }),
        db.location.findMany({
          where: {
            organizationId: context.organizationId,
            active: true,
            ...(context.organizationWideLocationAccess
              ? {}
              : { id: { in: [...context.allowedLocationIds] } }),
          },
          select: { id: true, name: true },
          orderBy: { code: "asc" },
        }),
      ])
    : [[], [], []];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Work orders"
        description="Manage repair, maintenance, and project work."
        breadcrumbs={[{ label: "Work orders" }]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" asChild>
              <Link href={`/app/${context.organizationId}/work-orders/workspace`}>Workspace</Link>
            </Button>
            {canCreate ? (
              <WorkOrderCreateForm
                startOpen={wantsNew === "1"}
                preselectedCustomerId={preselectedCustomer}
                customers={customers as { id: string; displayName: string }[]}
                assets={assets as { id: string; displayName: string; customerId: string }[]}
                locations={(locations as { id: string; name: string }[]).map((l) => ({
                  id: l.id,
                  displayName: l.name,
                }))}
              />
            ) : null}
          </div>
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <ListSearch
          action={`/app/${context.organizationId}/work-orders`}
          query={query}
          placeholder="Search RO #, customer, vehicle…"
          {...(statusFilter ? { hiddenParams: { status: statusFilter } } : {})}
        />
        <p className="text-sm text-muted-foreground">
          {workOrders.length} work order{workOrders.length === 1 ? "" : "s"}
        </p>
      </div>

      {chips.length > 0 ? (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by status">
          <Link
            href={chipHref(null)}
            className={
              statusFilter === null
                ? "min-h-11 rounded-md border border-primary bg-primary/10 px-3 py-1.5 text-sm text-primary"
                : "min-h-11 rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted"
            }
          >
            All ({chips.reduce((sum, row) => sum + row.count, 0)})
          </Link>
          {chips.map((row) => (
            <Link
              key={row.status}
              href={chipHref(row.status)}
              className={
                statusFilter === row.status
                  ? "min-h-11 rounded-md border border-primary bg-primary/10 px-3 py-1.5 text-sm text-primary"
                  : "min-h-11 rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted"
              }
            >
              {humanizeToken(row.status)} ({row.count})
            </Link>
          ))}
        </div>
      ) : null}

      <Card>
        <CardContent className="p-0">
          {workOrders.length === 0 ? (
            query ? (
              <EmptyState
                title="No work orders match your search"
                description={`Nothing found for “${query}”. Try a shorter search.`}
              />
            ) : (
              <EmptyState
                title="No work orders yet"
                description="Create the first repair order to get the board moving."
              />
            )
          ) : (
            <RecordList>
              {workOrders.map((wo) => (
                <RecordListRow
                  key={wo.id}
                  href={`/app/${context.organizationId}/work-orders/${wo.id}`}
                  title={wo.customer.displayName}
                  description={[
                    `#${wo.number}`,
                    wo.asset?.displayName,
                    wo.customerConcern?.trim() || undefined,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  trailing={
                    <>
                      <Badge variant="outline">{humanizeToken(wo.workType)}</Badge>
                      <WorkOrderStatusBadge status={wo.status} />
                    </>
                  }
                />
              ))}
            </RecordList>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
