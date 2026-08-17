import Link from "next/link";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SummaryCard } from "@/components/shopos/states";
import { PageHeader } from "@/components/shopos/page-header";
import { StatusBadge } from "@/components/shopos/status-badge";
import { db } from "@/db/client";
import { formatMoney } from "@/i18n/formatters";
import { getRequestContext } from "@/modules/tenancy/request-context";

/**
 * Organization dashboard — the post-sign-in landing experience.
 * Shows permission-aware real metrics: work-order counts by status, revenue,
 * pending authorizations, and recent activity.
 */
export default async function OrganizationDashboardPage({
  params,
}: {
  params: Promise<{ organization: string }>;
}) {
  const { organization } = await params;
  const context = await getRequestContext(organization);
  if (context.organizationId !== organization) {
    return <p className="text-destructive">Organization context mismatch.</p>;
  }

  const orgId = context.organizationId;
  const canReadCustomers = context.permissions.has("customers.read");
  const canReadWorkOrders = context.permissions.has("work_orders.read");
  const canManageMembers = context.permissions.has("memberships.manage");

  const [
    memberCount,
    customerCount,
    assetCount,
    woCounts,
    pendingAuthCount,
    recentWorkOrders,
    outstandingMinor,
  ] = await Promise.all([
    canManageMembers
      ? db.organizationMembership.count({ where: { organizationId: orgId, active: true } })
      : Promise.resolve(null),
    canReadCustomers
      ? db.customer.count({ where: { organizationId: orgId, archivedAt: null } })
      : Promise.resolve(null),
    canReadCustomers
      ? db.asset.count({ where: { organizationId: orgId, status: "ACTIVE" } })
      : Promise.resolve(null),
    canReadWorkOrders
      ? db.workOrder.groupBy({
          by: ["status"],
          where: { organizationId: orgId },
          _count: true,
        })
      : Promise.resolve([]),
    canReadWorkOrders
      ? db.workOrder.count({
          where: { organizationId: orgId, status: "AWAITING_AUTHORIZATION" },
        })
      : Promise.resolve(null),
    canReadWorkOrders
      ? db.workOrder.findMany({
          where: { organizationId: orgId },
          orderBy: { createdAt: "desc" },
          take: 5,
          select: {
            id: true,
            number: true,
            status: true,
            customerConcern: true,
            customer: { select: { displayName: true } },
          },
        })
      : Promise.resolve([]),
    canReadWorkOrders
      ? db.invoice.aggregate({
          where: { organizationId: orgId, status: { in: ["ISSUED", "PARTIALLY_PAID"] } },
          _sum: { totalMinor: true, paidMinor: true },
        })
      : Promise.resolve(null),
  ]);

  const woStatusMap = new Map(woCounts.map((w) => [w.status, w._count]));
  const openWOCount =
    (woStatusMap.get("DRAFT") ?? 0) +
    (woStatusMap.get("ESTIMATING") ?? 0) +
    (woStatusMap.get("AWAITING_AUTHORIZATION") ?? 0) +
    (woStatusMap.get("AUTHORIZED") ?? 0) +
    (woStatusMap.get("IN_PROGRESS") ?? 0) +
    (woStatusMap.get("BLOCKED") ?? 0);
  const inProgressCount = woStatusMap.get("IN_PROGRESS") ?? 0;
  const completedCount =
    (woStatusMap.get("COMPLETED") ?? 0) +
    (woStatusMap.get("INVOICED") ?? 0) +
    (woStatusMap.get("CLOSED") ?? 0);
  const outstandingBalance =
    outstandingMinor?._sum.totalMinor && outstandingMinor?._sum.paidMinor
      ? Number(outstandingMinor._sum.totalMinor) - Number(outstandingMinor._sum.paidMinor)
      : 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Overview"
        description="Your organization at a glance."
        breadcrumbs={[{ label: "Overview" }]}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {openWOCount !== null && canReadWorkOrders ? (
          <SummaryCard
            label="Open work orders"
            value={
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-2xl font-semibold tabular-nums">{openWOCount}</span>
                <Link
                  href={`/app/${orgId}/work-orders`}
                  className="text-sm text-link underline-offset-4 hover:underline"
                >
                  View →
                </Link>
              </div>
            }
          />
        ) : null}

        {inProgressCount !== null && canReadWorkOrders ? (
          <SummaryCard
            label="In progress"
            value={
              <span className="font-mono text-2xl font-semibold tabular-nums">
                {inProgressCount}
              </span>
            }
          />
        ) : null}

        {pendingAuthCount !== null && canReadWorkOrders ? (
          <SummaryCard
            label="Awaiting authorization"
            value={
              pendingAuthCount > 0 ? (
                <span className="font-mono text-2xl font-semibold tabular-nums text-warning">
                  {pendingAuthCount}
                </span>
              ) : (
                <span className="font-mono text-2xl font-semibold tabular-nums">
                  {pendingAuthCount}
                </span>
              )
            }
          />
        ) : null}

        {outstandingBalance > 0 ? (
          <SummaryCard
            label="Outstanding balance"
            value={
              <span className="font-mono text-2xl font-semibold tabular-nums">
                {formatMoney(outstandingBalance, "USD", "en-US")}
              </span>
            }
          />
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {customerCount !== null ? (
          <SummaryCard
            label="Customers"
            value={
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-2xl font-semibold tabular-nums">
                  {customerCount}
                </span>
                <Link
                  href={`/app/${orgId}/customers`}
                  className="text-sm text-link underline-offset-4 hover:underline"
                >
                  View →
                </Link>
              </div>
            }
          />
        ) : null}

        {assetCount !== null ? (
          <SummaryCard
            label="Assets"
            value={
              <span className="font-mono text-2xl font-semibold tabular-nums">{assetCount}</span>
            }
          />
        ) : null}

        {memberCount !== null ? (
          <SummaryCard
            label="Members"
            value={
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-2xl font-semibold tabular-nums">{memberCount}</span>
                <Link
                  href={`/app/${orgId}/members`}
                  className="text-sm text-link underline-offset-4 hover:underline"
                >
                  Manage →
                </Link>
              </div>
            }
          />
        ) : null}

        {completedCount !== null && canReadWorkOrders ? (
          <SummaryCard
            label="Completed work orders"
            value={
              <span className="font-mono text-2xl font-semibold tabular-nums">
                {completedCount}
              </span>
            }
          />
        ) : null}
      </div>

      {recentWorkOrders.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent work orders</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="px-4 py-3 font-medium">RO #</th>
                  <th className="px-4 py-3 font-medium">Customer</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Concern</th>
                  <th className="px-4 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {recentWorkOrders.map((wo) => (
                  <tr key={wo.id} className="border-b border-border/60 hover:bg-muted/30">
                    <td className="px-4 py-3 font-mono font-medium">{wo.number}</td>
                    <td className="px-4 py-3">{wo.customer.displayName}</td>
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
                    <td className="max-w-xs truncate px-4 py-3 text-muted-foreground">
                      {wo.customerConcern}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/app/${orgId}/work-orders/${wo.id}`}
                        className="text-link underline-offset-4 hover:underline"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Getting started</CardTitle>
            <CardDescription>Next steps for your shop.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
              <li>1. Add customers and their vehicles/equipment</li>
              <li>2. Create work orders for incoming service requests</li>
              <li>3. Build estimates, present to customers, record authorizations</li>
              <li>4. Complete work, issue invoices, and record payments</li>
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
