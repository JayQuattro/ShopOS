import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ListSearch } from "@/components/shopos/list-search";
import { PageHeader } from "@/components/shopos/page-header";
import { RecordList, RecordListRow } from "@/components/shopos/record-list";
import { EmptyState } from "@/components/shopos/states";
import { formatMoney } from "@/i18n/formatters";
import { db } from "@/db/client";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { listItems } from "@/modules/inventory/inventory-service";
import { InventoryForm } from "./inventory-form";
import { InterchangeLookup } from "./interchange-lookup";
import { UomSummary } from "./uom-summary";
import { WaitingByVendor } from "./waiting-by-vendor";
import { ReorderPanel } from "./reorder-panel";

export const dynamic = "force-dynamic";

/**
 * Parts stock: on-hand quantities, reorder points, and low-stock surfacing.
 * Receiving part orders into stock and issuing to jobs both land here.
 */
export default async function InventoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ organization: string }>;
  searchParams: Promise<{ location?: string; q?: string }>;
}) {
  const { organization } = await params;
  const { location: locationParam, q: search } = await searchParams;
  const context = await getRequestContext(organization);
  if (context.organizationId !== organization) {
    return <p className="text-destructive">Organization context mismatch.</p>;
  }

  const locations = await db.location.findMany({
    where: {
      organizationId: context.organizationId,
      active: true,
      ...(context.organizationWideLocationAccess
        ? {}
        : { id: { in: [...context.allowedLocationIds] } }),
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const items = await listItems(
    { db, context },
    ...(locationParam ? [{ locationId: locationParam }] : []),
  );

  const query = search?.trim().toLowerCase() ?? "";
  const shown = query
    ? items.filter((item) =>
        [item.name, item.partNumber, item.brand, item.oeNumber, item.binLocation]
          .filter((value): value is string => typeof value === "string" && value.length > 0)
          .some((value) => value.toLowerCase().includes(query)),
      )
    : items;
  const lowItems = items.filter((item) => item.low);
  const totalValueMinor = items.reduce(
    (sum, item) => sum + Number(item.unitCostMinor) * item.quantityOnHand,
    0,
  );
  const currency = items[0]?.currency ?? "USD";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Inventory"
        description="Parts on the shelf — quantities, reorder points, and value."
        breadcrumbs={[{ label: "Inventory" }]}
        actions={
          context.permissions.has("work_orders.write") ? (
            <InventoryForm
              locations={locations.map((location) => ({ id: location.id, name: location.name }))}
              canManageCategories={context.permissions.has("work_orders.write")}
            />
          ) : undefined
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <ListSearch
          action={`/app/${context.organizationId}/inventory`}
          query={search?.trim() ?? ""}
          placeholder="Search part name, number, brand, bin…"
          hiddenParams={{ location: locationParam }}
        />
        <p className="text-sm text-muted-foreground">
          {query ? (
            <>
              {shown.length} matching part{shown.length === 1 ? "" : "s"}
            </>
          ) : (
            <>
              {items.length} item{items.length === 1 ? "" : "s"} · stock value{" "}
              <strong className="text-foreground">
                {formatMoney(totalValueMinor, currency, "en-US")}
              </strong>
            </>
          )}
          {lowItems.length > 0 ? (
            <Badge variant="destructive" className="ml-2">
              {lowItems.length} at or below reorder point
            </Badge>
          ) : null}
        </p>
      </div>

      <ReorderPanel canWrite={context.permissions.has("work_orders.write")} />

      <UomSummary />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Waiting on vendors</CardTitle>
        </CardHeader>
        <CardContent>
          <WaitingByVendor />
        </CardContent>
      </Card>

      <InterchangeLookup />

      <Card>
        <CardContent className="p-0">
          {shown.length === 0 ? (
            query ? (
              <EmptyState
                title="No parts match your search"
                description={`Nothing found for “${search?.trim()}”. Try a part number or brand.`}
              />
            ) : (
              <EmptyState
                title="No stock yet"
                description="Add parts, or receive a part order into stock from a work order."
              />
            )
          ) : (
            <RecordList>
              {[...shown]
                .sort((a, b) => Number(b.low) - Number(a.low) || a.name.localeCompare(b.name))
                .map((item) => (
                  <RecordListRow
                    key={item.id}
                    href={`/app/${organization}/inventory/${item.id}`}
                    title={item.name}
                    description={
                      [
                        item.partNumber,
                        item.brand,
                        item.oeNumber ? `OE ${item.oeNumber}` : undefined,
                        item.binLocation,
                        item.condition !== "new" ? item.condition : undefined,
                        item.hasCore ? "core" : undefined,
                        item.consumable ? "supply" : undefined,
                        item.nonSaleable ? "internal" : undefined,
                      ]
                        .filter(Boolean)
                        .join(" · ") || undefined
                    }
                    trailing={
                      <>
                        <span className="font-mono text-sm tabular-nums">
                          {item.quantityOnHand}
                          {item.unitOfMeasure ? ` ${item.unitOfMeasure}` : ""}
                        </span>
                        {item.low ? (
                          <Badge variant="destructive" className="text-[10px]">
                            low
                          </Badge>
                        ) : null}
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
