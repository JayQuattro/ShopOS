import { Card, CardContent } from "@/components/ui/card";
import { ListSearch } from "@/components/shopos/list-search";
import { PageHeader } from "@/components/shopos/page-header";
import { EmptyState } from "@/components/shopos/states";
import { db } from "@/db/client";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { KeyCard } from "./key-card";

export const dynamic = "force-dynamic";

/**
 * The key board: every vehicle still in the shop with its key tag and where
 * the key lives. Editable in place — this page answers "where are the keys"
 * at a glance, including jobs waiting on parts or pickup. Built as a card
 * grid with full-size controls for wall-mounted tablet use.
 */
export default async function KeysPage({
  params,
  searchParams,
}: {
  params: Promise<{ organization: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { organization } = await params;
  const { q: search } = await searchParams;
  const context = await getRequestContext(organization);
  if (context.organizationId !== organization) {
    return <p className="text-destructive">Organization context mismatch.</p>;
  }

  const workOrders = await db.workOrder.findMany({
    where: {
      organizationId: context.organizationId,
      status: {
        in: [
          "DRAFT",
          "ESTIMATING",
          "AWAITING_AUTHORIZATION",
          "AUTHORIZED",
          "IN_PROGRESS",
          "BLOCKED",
          "COMPLETED",
          "INVOICED",
        ],
      },
      ...(context.organizationWideLocationAccess
        ? {}
        : { locationId: { in: [...context.allowedLocationIds] } }),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      number: true,
      status: true,
      vehicleStage: true,
      bayLabel: true,
      keyTag: true,
      keyLocation: true,
      customer: { select: { displayName: true } },
      asset: { select: { displayName: true } },
    },
  });

  const canWrite = context.permissions.has("work_orders.write");
  const orgId = context.organizationId;
  const query = search?.trim().toLowerCase() ?? "";
  const filtered = query
    ? workOrders.filter((wo) =>
        [
          wo.number,
          wo.customer.displayName,
          wo.asset?.displayName ?? "",
          wo.keyTag ?? "",
          wo.keyLocation ?? "",
        ].some((field) => field.toLowerCase().includes(query)),
      )
    : workOrders;

  const withKeys = filtered.filter((wo) => wo.keyTag);
  const missing = filtered.filter((wo) => !wo.keyTag);
  const missingTotal = workOrders.filter((wo) => !wo.keyTag).length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Keys"
        description="Which key tag goes with which job — and where it lives right now."
        breadcrumbs={[{ label: "Keys" }]}
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <ListSearch
          action={`/app/${orgId}/keys`}
          query={search?.trim() ?? ""}
          placeholder="Search RO #, tag, customer, vehicle…"
        />
        <p className="text-sm text-muted-foreground">
          {filtered.length} job{filtered.length === 1 ? "" : "s"}
          {missingTotal > 0 ? ` · ${missingTotal} without a key tag` : ""}
        </p>
      </div>

      {workOrders.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState title="No vehicles in the shop right now" />
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              title="No jobs match your search"
              description={`Nothing found for “${search?.trim()}”. Try an RO number, tag, or customer name.`}
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[...withKeys, ...missing].map((wo) => (
            <KeyCard
              key={wo.id}
              canWrite={canWrite}
              workOrder={{
                id: wo.id,
                number: wo.number,
                stage: wo.vehicleStage,
                bay: wo.bayLabel,
                customerName: wo.customer.displayName,
                assetName: wo.asset?.displayName ?? null,
                keyTag: wo.keyTag,
                keyLocation: wo.keyLocation,
                href: `/app/${orgId}/work-orders/${wo.id}`,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
