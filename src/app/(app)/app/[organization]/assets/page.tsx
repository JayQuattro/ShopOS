import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ListSearch } from "@/components/shopos/list-search";
import { PageHeader } from "@/components/shopos/page-header";
import { RecordList, RecordListRow } from "@/components/shopos/record-list";
import { EmptyState } from "@/components/shopos/states";
import { humanizeToken } from "@/lib/labels";
import { db } from "@/db/client";
import { getRequestContext } from "@/modules/tenancy/request-context";

export default async function AssetsPage({
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

  const query = search?.trim() ?? "";
  const assets = await db.asset.findMany({
    where: {
      organizationId: context.organizationId,
      status: { not: "SOLD" },
      ...(query
        ? {
            OR: [
              { displayName: { contains: query, mode: "insensitive" } },
              { manufacturer: { contains: query, mode: "insensitive" } },
              { model: { contains: query, mode: "insensitive" } },
              { serialNumber: { contains: query, mode: "insensitive" } },
              {
                automotiveProfile: {
                  OR: [
                    { licensePlate: { contains: query, mode: "insensitive" } },
                    { vin: { contains: query, mode: "insensitive" } },
                  ],
                },
              },
              { customer: { displayName: { contains: query, mode: "insensitive" } } },
            ],
          }
        : {}),
    },
    orderBy: { displayName: "asc" },
    select: {
      id: true,
      displayName: true,
      category: true,
      manufacturer: true,
      model: true,
      modelYear: true,
      status: true,
      customer: { select: { id: true, displayName: true } },
      automotiveProfile: { select: { licensePlate: true } },
    },
    take: 100,
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Vehicles"
        description="Customer vehicles, equipment, and anything else you service."
        breadcrumbs={[{ label: "Assets" }]}
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <ListSearch
          action={`/app/${context.organizationId}/assets`}
          query={query}
          placeholder="Search vehicle, plate, VIN, owner…"
        />
        <p className="text-sm text-muted-foreground">
          {assets.length} vehicle{assets.length === 1 ? "" : "s"}
        </p>
      </div>

      <Card>
        <CardContent className="p-0">
          {assets.length === 0 ? (
            query ? (
              <EmptyState
                title="No vehicles match your search"
                description={`Nothing found for “${query}”. Try a name, plate, or owner.`}
              />
            ) : (
              <EmptyState
                title="No vehicles yet"
                description="Add a vehicle from a customer profile to see it here."
              />
            )
          ) : (
            <RecordList>
              {assets.map((a) => (
                <RecordListRow
                  key={a.id}
                  href={`/app/${context.organizationId}/assets/${a.id}`}
                  title={a.displayName}
                  description={[
                    [a.modelYear, a.manufacturer, a.model].filter(Boolean).join(" ") || undefined,
                    a.automotiveProfile?.licensePlate
                      ? `Plate ${a.automotiveProfile.licensePlate}`
                      : undefined,
                    a.customer.displayName,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  trailing={<Badge variant="outline">{humanizeToken(a.category)}</Badge>}
                />
              ))}
            </RecordList>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
