import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/shopos/page-header";
import { PageSection } from "@/components/shopos/section";
import { RecordList, RecordListRow } from "@/components/shopos/record-list";
import { EmptyState } from "@/components/shopos/states";
import { WorkOrderStatusBadge } from "@/components/shopos/status-badge";
import { humanizeToken } from "@/lib/labels";
import { db } from "@/db/client";
import { formatDate, formatMoney } from "@/i18n/formatters";
import { MaintenancePanel } from "./maintenance-panel";
import { activeWarrantyForAsset } from "@/modules/invoices/warranty-service";
import { getRequestContext } from "@/modules/tenancy/request-context";

export default async function AssetDetailPage({
  params,
}: {
  params: Promise<{ organization: string; assetId: string }>;
}) {
  const { organization, assetId } = await params;
  const context = await getRequestContext(organization);
  if (context.organizationId !== organization) {
    return <p className="text-destructive">Organization context mismatch.</p>;
  }

  const asset = await db.asset.findFirst({
    where: { id: assetId, organizationId: context.organizationId },
    include: {
      customer: { select: { id: true, displayName: true } },
      automotiveProfile: true,
      equipmentProfile: true,
      workOrders: {
        orderBy: { createdAt: "desc" },
        take: 25,
        select: {
          id: true,
          number: true,
          status: true,
          customerConcern: true,
          createdAt: true,
          invoice: {
            select: { status: true, currency: true, totalMinor: true, paidMinor: true },
          },
        },
      },
    },
  });

  if (!asset) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-sm text-muted-foreground">Asset not found.</p>
          <Link
            href={`/app/${context.organizationId}/assets`}
            className="text-link underline-offset-4 hover:underline"
          >
            ← Back to assets
          </Link>
        </CardContent>
      </Card>
    );
  }

  const warrantyCoverage = asset
    ? await activeWarrantyForAsset({ db, context, assetId: asset.id })
    : [];

  const newWorkOrderHref = `/app/${context.organizationId}/work-orders?new=1&customer=${asset.customer.id}`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={asset.displayName}
        description={humanizeToken(asset.status)}
        breadcrumbs={[
          { label: "Assets", href: `/app/${context.organizationId}/assets` },
          { label: asset.displayName },
        ]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {context.permissions.has("work_orders.write") ? (
              <Button asChild>
                <Link href={newWorkOrderHref}>New work order</Link>
              </Button>
            ) : null}
          </div>
        }
      />

      <PageSection id="overview" title="Overview">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardContent className="py-4">
              <p className="text-xs text-muted-foreground">Owner</p>
              <Link
                href={`/app/${context.organizationId}/customers/${asset.customer.id}`}
                className="font-medium text-link underline-offset-4 hover:underline"
              >
                {asset.customer.displayName}
              </Link>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <p className="text-xs text-muted-foreground">Category</p>
              <div className="mt-1">
                <Badge variant="outline">{humanizeToken(asset.category)}</Badge>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <p className="text-xs text-muted-foreground">Make / model</p>
              <p className="font-medium">
                {[asset.manufacturer, asset.model].filter(Boolean).join(" ") || "—"}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <p className="text-xs text-muted-foreground">Year · serial</p>
              <p className="font-medium">
                {[asset.modelYear?.toString(), asset.serialNumber].filter(Boolean).join(" · ") ||
                  "—"}
              </p>
            </CardContent>
          </Card>
        </div>
      </PageSection>

      {asset.automotiveProfile ? (
        <PageSection id="profile" title="Vehicle details">
          <Card>
            <CardContent className="grid gap-4 py-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <p className="text-xs text-muted-foreground">VIN</p>
                <p className="font-mono font-medium">{asset.automotiveProfile.vin ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">License plate</p>
                <p className="font-mono font-medium">
                  {asset.automotiveProfile.licensePlate ?? "—"}
                  {asset.automotiveProfile.plateJurisdiction
                    ? ` · ${asset.automotiveProfile.plateJurisdiction}`
                    : ""}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Mileage</p>
                <p className="font-medium tabular-nums">
                  {asset.automotiveProfile.lastKnownMileage
                    ? asset.automotiveProfile.lastKnownMileage.toLocaleString("en-US")
                    : "—"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Engine</p>
                <p className="font-medium">{asset.automotiveProfile.engine ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Transmission</p>
                <p className="font-medium">{asset.automotiveProfile.transmission ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Drivetrain · trim</p>
                <p className="font-medium">
                  {[asset.automotiveProfile.drivetrain, asset.automotiveProfile.trim]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </p>
              </div>
            </CardContent>
          </Card>
        </PageSection>
      ) : null}

      {asset.equipmentProfile ? (
        <PageSection id="profile" title="Equipment details">
          <Card>
            <CardContent className="grid gap-4 py-4 sm:grid-cols-3">
              <div>
                <p className="text-xs text-muted-foreground">Engine model</p>
                <p className="font-medium">{asset.equipmentProfile.engineModel ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Fuel type</p>
                <p className="font-medium">{asset.equipmentProfile.fuelType ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Category</p>
                <p className="font-medium">{asset.equipmentProfile.equipmentCategory ?? "—"}</p>
              </div>
            </CardContent>
          </Card>
        </PageSection>
      ) : null}

      <PageSection id="maintenance" title="Maintenance schedule">
        <MaintenancePanel
          assetId={asset.id}
          isAutomobile={asset.category === "automobile"}
          canWrite={context.permissions.has("assets.write")}
        />
      </PageSection>

      <PageSection
        id="warranty"
        title="Warranty coverage"
        description="Open coverage from issued invoices — so warrantied work isn't re-charged by accident."
      >
        {warrantyCoverage.length === 0 ? (
          <p className="text-sm text-muted-foreground">No open warranty coverage.</p>
        ) : (
          <RecordList>
            {warrantyCoverage.map((coverage) => (
              <RecordListRow
                key={coverage.invoiceId}
                href={`/app/${context.organizationId}/work-orders/${coverage.workOrderId}`}
                title={`${coverage.workOrderNumber} · ${coverage.invoiceNumber}`}
                description={[
                  coverage.customerConcern,
                  `issued ${formatDate(coverage.issuedAt, "UTC", "en-US")}`,
                  coverage.expiresAt
                    ? `covered until ${formatDate(coverage.expiresAt, "UTC", "en-US")}`
                    : "time-unlimited",
                  coverage.warrantyMiles
                    ? `or ${Intl.NumberFormat("en-US").format(coverage.warrantyMiles)} mi from invoice (last known ${Intl.NumberFormat("en-US").format(coverage.lastKnownMileage ?? 0)} mi)`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              />
            ))}
          </RecordList>
        )}
      </PageSection>

      <PageSection id="history" title="Service history" description="Last 25 visits.">
        <Card>
          {asset.workOrders.length === 0 ? (
            <CardContent>
              <EmptyState
                title="No service history yet"
                description="Start the first work order with the button up top."
              />
            </CardContent>
          ) : (
            <CardContent className="p-0">
              <RecordList>
                {asset.workOrders.map((wo) => (
                  <RecordListRow
                    key={wo.id}
                    href={`/app/${context.organizationId}/work-orders/${wo.id}`}
                    title={wo.customerConcern?.trim() || "Service visit"}
                    description={`#${wo.number} · ${formatDate(wo.createdAt, "UTC", "en-US")}`}
                    trailing={
                      <>
                        {wo.invoice ? (
                          <span className="font-mono text-sm tabular-nums">
                            {formatMoney(
                              Number(wo.invoice.totalMinor),
                              wo.invoice.currency,
                              "en-US",
                            )}
                          </span>
                        ) : null}
                        <WorkOrderStatusBadge status={wo.status} />
                      </>
                    }
                  />
                ))}
              </RecordList>
            </CardContent>
          )}
        </Card>
      </PageSection>
    </div>
  );
}
