import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SummaryCard } from "@/components/shopos/states";
import { PageHeader } from "@/components/shopos/page-header";
import { db } from "@/db/client";
import { getRequestContext } from "@/modules/tenancy/request-context";

export default async function AssetDetailPage({
  params,
}: {
  params: Promise<{ organization: string; assetId: string }>;
}) {
  const context = await getRequestContext();
  const { organization, assetId } = await params;
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
        take: 10,
        select: { id: true, number: true, status: true, customerConcern: true },
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

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={asset.displayName}
        breadcrumbs={[
          { label: "Assets", href: `/app/${context.organizationId}/assets` },
          { label: asset.displayName },
        ]}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="Category" value={<Badge variant="outline">{asset.category}</Badge>} />
        <SummaryCard label="Manufacturer" value={asset.manufacturer ?? "—"} />
        <SummaryCard label="Model" value={asset.model ?? "—"} />
        <SummaryCard label="Year" value={asset.modelYear?.toString() ?? "—"} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <SummaryCard label="Serial number" value={asset.serialNumber ?? "—"} />
        <SummaryCard
          label="Status"
          value={
            <Badge variant={asset.status === "ACTIVE" ? "default" : "secondary"}>
              {asset.status.toLowerCase()}
            </Badge>
          }
        />
        <SummaryCard
          label="Owner"
          value={
            <Link
              href={`/app/${context.organizationId}/customers/${asset.customer.id}`}
              className="text-link underline-offset-4 hover:underline"
            >
              {asset.customer.displayName}
            </Link>
          }
        />
      </div>

      {asset.automotiveProfile ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Automotive profile</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <SummaryCard
                label="VIN"
                value={<span className="font-mono">{asset.automotiveProfile.vin ?? "—"}</span>}
              />
              <SummaryCard label="Trim" value={asset.automotiveProfile.trim ?? "—"} />
              <SummaryCard label="Engine" value={asset.automotiveProfile.engine ?? "—"} />
              <SummaryCard label="Drivetrain" value={asset.automotiveProfile.drivetrain ?? "—"} />
              <SummaryCard
                label="License plate"
                value={asset.automotiveProfile.licensePlate ?? "—"}
              />
              <SummaryCard
                label="Transmission"
                value={asset.automotiveProfile.transmission ?? "—"}
              />
            </div>
          </CardContent>
        </Card>
      ) : null}

      {asset.equipmentProfile ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Equipment profile</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-3">
              <SummaryCard label="Engine model" value={asset.equipmentProfile.engineModel ?? "—"} />
              <SummaryCard label="Fuel type" value={asset.equipmentProfile.fuelType ?? "—"} />
              <SummaryCard
                label="Category"
                value={asset.equipmentProfile.equipmentCategory ?? "—"}
              />
            </div>
          </CardContent>
        </Card>
      ) : null}

      {asset.workOrders.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent work orders</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">RO #</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium">Concern</th>
                  <th className="py-2 pr-4 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {asset.workOrders.map((wo) => (
                  <tr key={wo.id} className="border-b border-border/60">
                    <td className="py-3 pr-4 font-mono">{wo.number}</td>
                    <td className="py-3 pr-4 capitalize">
                      {wo.status.replace(/_/g, " ").toLowerCase()}
                    </td>
                    <td className="py-3 pr-4 max-w-md truncate text-muted-foreground">
                      {wo.customerConcern}
                    </td>
                    <td className="py-3 pr-4">
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
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
