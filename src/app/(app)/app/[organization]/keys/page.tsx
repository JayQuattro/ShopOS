import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/shopos/page-header";
import { db } from "@/db/client";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { KeyRow } from "./key-row";

export const dynamic = "force-dynamic";

/**
 * The key board: every vehicle still in the shop with its key tag and where
 * the key lives. Editable in place — this page answers "where are the keys"
 * at a glance, including jobs waiting on parts or pickup.
 */
export default async function KeysPage({ params }: { params: Promise<{ organization: string }> }) {
  const { organization } = await params;
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
  const withKeys = workOrders.filter((wo) => wo.keyTag);
  const missing = workOrders.filter((wo) => !wo.keyTag);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Keys"
        description="Which key tag goes with which job — and where it lives right now."
        breadcrumbs={[{ label: "Keys" }]}
      />

      <Card>
        <CardContent className="p-0">
          {workOrders.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-muted-foreground">
              No vehicles in the shop right now.
            </p>
          ) : (
            <>
              <p className="border-b border-border px-4 py-3 text-sm text-muted-foreground">
                {workOrders.length} open job{workOrders.length === 1 ? "" : "s"} · {missing.length}{" "}
                without a key tag
              </p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="px-4 py-3 font-medium">Job</th>
                    <th className="px-4 py-3 font-medium">Customer / vehicle</th>
                    <th className="px-4 py-3 font-medium">Where it is</th>
                    <th className="px-4 py-3 font-medium">Key tag</th>
                    <th className="px-4 py-3 font-medium">Key location</th>
                  </tr>
                </thead>
                <tbody>
                  {[...withKeys, ...missing].map((wo) => (
                    <KeyRow
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
                </tbody>
              </table>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
