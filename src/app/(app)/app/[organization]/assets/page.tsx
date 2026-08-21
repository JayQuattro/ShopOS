import Link from "next/link";

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
  searchParams: Promise<{ q?: string; cat?: string }>;
}) {
  const { organization } = await params;
  const { q: search, cat: categoryParam } = await searchParams;
  const context = await getRequestContext(organization);
  if (context.organizationId !== organization) {
    return <p className="text-destructive">Organization context mismatch.</p>;
  }

  const query = search?.trim() ?? "";
  const category = categoryParam?.trim() ?? "";
  const assets = await db.asset.findMany({
    where: {
      organizationId: context.organizationId,
      status: { not: "SOLD" },
      ...(category ? { category } : {}),
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

  const categoryCounts = await db.asset.groupBy({
    by: ["category"],
    where: { organizationId: context.organizationId, status: { not: "SOLD" } },
    _count: { category: true },
  });
  const chips = categoryCounts
    .map((row) => ({ key: row.category, count: row._count.category }))
    .sort((a, b) => b.count - a.count);
  const chipHref = (cat: string) => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (cat) params.set("cat", cat);
    const qs = params.toString();
    return qs
      ? `/app/${context.organizationId}/assets?${qs}`
      : `/app/${context.organizationId}/assets`;
  };

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
          {...(category ? { hiddenParams: { cat: category } } : {})}
        />
        <p className="text-sm text-muted-foreground">
          {assets.length} vehicle{assets.length === 1 ? "" : "s"}
          {category ? ` · ${humanizeToken(category)}` : ""}
        </p>
      </div>

      {chips.length > 1 ? (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by type">
          <Link
            href={chipHref("")}
            className={`min-h-11 rounded-md border px-3 py-1.5 text-sm transition-colors ${
              category === ""
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:bg-muted"
            }`}
          >
            All ({chips.reduce((sum, chip) => sum + chip.count, 0)})
          </Link>
          {chips.map((chip) => (
            <Link
              key={chip.key}
              href={chipHref(chip.key)}
              className={`min-h-11 rounded-md border px-3 py-1.5 text-sm transition-colors ${
                category === chip.key
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              {humanizeToken(chip.key)} ({chip.count})
            </Link>
          ))}
        </div>
      ) : null}

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
