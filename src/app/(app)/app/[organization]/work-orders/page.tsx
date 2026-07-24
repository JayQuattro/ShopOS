import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/shopos/page-header";
import { StatusBadge } from "@/components/shopos/status-badge";
import { db } from "@/db/client";
import { getRequestContext } from "@/modules/tenancy/request-context";

export default async function WorkOrdersPage({
  params,
}: {
  params: Promise<{ organization: string }>;
}) {
  const context = await getRequestContext();
  const { organization } = await params;
  if (context.organizationId !== organization) {
    return <p className="text-destructive">Organization context mismatch.</p>;
  }

  const workOrders = await db.workOrder.findMany({
    where: {
      organizationId: context.organizationId,
      ...(context.organizationWideLocationAccess
        ? {}
        : { locationId: { in: [...context.allowedLocationIds] } }),
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

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Work orders"
        description="Manage repair, maintenance, and project work."
        breadcrumbs={[{ label: "Work orders" }]}
      />

      <Card>
        <CardContent className="p-0">
          {workOrders.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-muted-foreground">
              No work orders yet.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="px-4 py-3 font-medium">RO #</th>
                  <th className="px-4 py-3 font-medium">Customer</th>
                  <th className="px-4 py-3 font-medium">Asset</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {workOrders.map((wo) => (
                  <tr key={wo.id} className="border-b border-border/60 hover:bg-muted/30">
                    <td className="px-4 py-3 font-mono font-medium">{wo.number}</td>
                    <td className="px-4 py-3">{wo.customer.displayName}</td>
                    <td className="px-4 py-3 text-muted-foreground">{wo.asset.displayName}</td>
                    <td className="px-4 py-3">
                      <StatusBadge
                        tone={
                          wo.status === "COMPLETED" || wo.status === "CLOSED"
                            ? "ready"
                            : wo.status === "IN_PROGRESS"
                              ? "waiting"
                              : wo.status === "BLOCKED" || wo.status === "CANCELLED"
                                ? "attention"
                                : "neutral"
                        }
                      >
                        {wo.status.replace(/_/g, " ").toLowerCase()}
                      </StatusBadge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="outline">{wo.workType.toLowerCase()}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/app/${context.organizationId}/work-orders/${wo.id}`}
                        className="text-link underline-offset-4 hover:underline"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
