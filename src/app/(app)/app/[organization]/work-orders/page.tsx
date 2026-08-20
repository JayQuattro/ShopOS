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

export default async function WorkOrdersPage({
  params,
  searchParams,
}: {
  params: Promise<{ organization: string }>;
  searchParams: Promise<{ new?: string; customer?: string; q?: string }>;
}) {
  const { organization } = await params;
  const { new: wantsNew, customer: preselectedCustomer, q: search } = await searchParams;
  const context = await getRequestContext(organization);
  if (context.organizationId !== organization) {
    return <p className="text-destructive">Organization context mismatch.</p>;
  }

  const query = search?.trim() ?? "";
  const workOrders = await db.workOrder.findMany({
    where: {
      organizationId: context.organizationId,
      ...(context.organizationWideLocationAccess
        ? {}
        : { locationId: { in: [...context.allowedLocationIds] } }),
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
        />
        <p className="text-sm text-muted-foreground">
          {workOrders.length} work order{workOrders.length === 1 ? "" : "s"}
        </p>
      </div>

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
