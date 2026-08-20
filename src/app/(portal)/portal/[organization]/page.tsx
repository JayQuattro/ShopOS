import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shopos/page-header";
import { SummaryCard } from "@/components/shopos/states";
import { db } from "@/db/client";
import { formatDate, formatMoney } from "@/i18n/formatters";
import { getCurrentSession } from "@/modules/identity/session";
import { getPortalShopView } from "@/modules/portal/portal-service";

export const dynamic = "force-dynamic";

function statusLabel(status: string): string {
  return status.replace(/_/g, " ").toLowerCase();
}

/**
 * A customer's own view of one shop. Everything is scoped to the linked
 * customer record server-side; the page renders only what the query returns.
 */
export default async function PortalShopPage({
  params,
}: {
  params: Promise<{ organization: string }>;
}) {
  const { organization } = await params;
  const session = await getCurrentSession();
  const view = session ? await getPortalShopView(db, session.user.id, organization) : null;
  if (!view) notFound();

  const openBalance = view.statement?.balanceMinor ?? 0n;
  const currency = view.statement?.currency ?? view.invoices[0]?.currency ?? "USD";
  const openJobs = view.workOrders.filter(
    (workOrder) => workOrder.status !== "CLOSED" && workOrder.status !== "CANCELLED",
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={view.organization.name}
        description={`${view.customer.displayName}${view.customer.isAccountCustomer ? " · billed on account" : ""}`}
        breadcrumbs={[
          { label: "Customer portal", href: "/portal" },
          { label: view.organization.name },
        ]}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard label="Open visits" value={String(openJobs.length)} />
        <SummaryCard label="Vehicles" value={String(view.vehicles.length)} />
        <SummaryCard label="Balance" value={formatMoney(Number(openBalance), currency, "en-US")} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Service visits</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {view.workOrders.length === 0 ? (
            <p className="text-sm text-muted-foreground">No service visits yet.</p>
          ) : (
            view.workOrders.map((workOrder) => (
              <div
                key={workOrder.id}
                className="flex flex-col gap-1 rounded-lg border border-border p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-sm font-medium">{workOrder.number}</span>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-[10px]">
                      {statusLabel(workOrder.status)}
                    </Badge>
                    {workOrder.completedAt ? (
                      <span className="text-xs text-muted-foreground">
                        done {formatDate(workOrder.completedAt, "UTC", "en-US")}
                      </span>
                    ) : workOrder.promisedAt ? (
                      <span className="text-xs text-muted-foreground">
                        promised {formatDate(workOrder.promisedAt, "UTC", "en-US")}
                      </span>
                    ) : null}
                  </div>
                </div>
                {workOrder.assetName ? (
                  <p className="text-xs text-muted-foreground">{workOrder.assetName}</p>
                ) : null}
                <p className="text-sm">{workOrder.customerConcern}</p>
                {workOrder.trackerToken ? (
                  <Link
                    href={`/track/${workOrder.trackerToken}`}
                    className="text-sm text-link underline-offset-4 hover:underline"
                  >
                    Follow live progress →
                  </Link>
                ) : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Your vehicles</CardTitle>
          </CardHeader>
          <CardContent>
            {view.vehicles.length === 0 ? (
              <p className="text-sm text-muted-foreground">No vehicles on file.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border/60">
                {view.vehicles.map((vehicle) => (
                  <li key={vehicle.id} className="flex items-center justify-between py-2 text-sm">
                    <span>{vehicle.displayName}</span>
                    <span className="text-xs text-muted-foreground">{vehicle.category ?? ""}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Invoices</CardTitle>
          </CardHeader>
          <CardContent>
            {view.invoices.length === 0 ? (
              <p className="text-sm text-muted-foreground">No invoices yet.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border/60">
                {view.invoices.map((invoice) => (
                  <li
                    key={invoice.id}
                    className="flex items-center justify-between gap-2 py-2 text-sm"
                  >
                    <span className="font-mono text-xs">{invoice.number}</span>
                    <span className="text-xs text-muted-foreground">
                      {invoice.issuedAt ? formatDate(invoice.issuedAt, "UTC", "en-US") : "draft"}
                    </span>
                    <span className="font-mono tabular-nums">
                      {formatMoney(Number(invoice.totalMinor), invoice.currency, "en-US")}
                      {invoice.paidMinor < invoice.totalMinor ? (
                        <Badge variant="outline" className="ml-2 text-[10px]">
                          due{" "}
                          {formatMoney(
                            Number(invoice.totalMinor - invoice.paidMinor),
                            invoice.currency,
                            "en-US",
                          )}
                        </Badge>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {view.statement && view.statement.lines.length > 0 ? (
              <p className="mt-3 border-t border-border pt-3 text-sm text-muted-foreground">
                Statement balance{" "}
                <span className="font-mono font-medium text-foreground">
                  {formatMoney(
                    Number(view.statement.balanceMinor),
                    view.statement.currency,
                    "en-US",
                  )}
                </span>
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {view.loaner ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Your loaner</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 text-sm">
            <p className="font-medium">{view.loaner.assetName}</p>
            <p className="text-muted-foreground">
              Since {formatDate(view.loaner.checkedOutAt, "UTC", "en-US")}
              {view.loaner.outMileage !== null
                ? ` · ${view.loaner.outMileage.toLocaleString("en-US")} miles at pickup`
                : ""}
              {view.loaner.fuelOut !== null ? ` · fuel ${view.loaner.fuelOut}% at pickup` : ""}
            </p>
            {view.loaner.conditionNote ? (
              <p className="text-muted-foreground">Noted at pickup: {view.loaner.conditionNote}</p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {view.organization.contactPhone || view.organization.contactEmail ? (
        <p className="text-sm text-muted-foreground">
          Questions? Contact the shop
          {view.organization.contactPhone ? ` at ${view.organization.contactPhone}` : ""}
          {view.organization.contactEmail ? ` · ${view.organization.contactEmail}` : ""}.
        </p>
      ) : null}
    </div>
  );
}
