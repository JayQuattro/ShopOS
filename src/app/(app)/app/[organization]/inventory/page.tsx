import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/shopos/page-header";
import { db } from "@/db/client";
import { formatMoney } from "@/i18n/formatters";
import { getRequestContext } from "@/modules/tenancy/request-context";
import { listItems } from "@/modules/inventory/inventory-service";
import { InventoryForm } from "./inventory-form";
import { InterchangeLookup } from "./interchange-lookup";
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
  searchParams: Promise<{ location?: string }>;
}) {
  const { organization } = await params;
  const { location: locationParam } = await searchParams;
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

      <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
        <span>
          {items.length} item{items.length === 1 ? "" : "s"} · stock value{" "}
          <strong className="text-foreground">
            {formatMoney(totalValueMinor, currency, "en-US")}
          </strong>
        </span>
        {lowItems.length > 0 ? (
          <Badge variant="destructive">{lowItems.length} at or below reorder point</Badge>
        ) : null}
      </div>

      <ReorderPanel canWrite={context.permissions.has("work_orders.write")} />

      <InterchangeLookup />

      <Card>
        <CardContent className="p-0">
          {items.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-muted-foreground">
              No stock yet. Add parts, or receive a part order into stock from a work order.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Part</th>
                  <th className="px-4 py-3 font-medium">Part #</th>
                  <th className="px-4 py-3 font-medium">Brand / OE</th>
                  <th className="px-4 py-3 font-medium text-right">On hand</th>
                  <th className="px-4 py-3 font-medium text-right">Reorder at</th>
                  <th className="px-4 py-3 font-medium text-right">Unit cost</th>
                  <th className="px-4 py-3 font-medium">Flags</th>
                  <th className="px-4 py-3 font-medium">Bin</th>
                </tr>
              </thead>
              <tbody>
                {[...items]
                  .sort((a, b) => Number(b.low) - Number(a.low) || a.name.localeCompare(b.name))
                  .map((item) => (
                    <tr key={item.id} className="border-b border-border/60 hover:bg-muted/30">
                      <td className="px-4 py-3 font-medium">
                        {item.name}
                        {item.low ? (
                          <Badge variant="destructive" className="ml-2 text-[10px]">
                            low
                          </Badge>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{item.partNumber}</td>
                      <td className="px-4 py-3 text-xs">
                        {item.brand ? <span className="block">{item.brand}</span> : null}
                        {item.oeNumber ? (
                          <span className="block font-mono text-[10px] text-muted-foreground">
                            OE {item.oeNumber}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">
                        {item.quantityOnHand}
                        {item.unitOfMeasure ? (
                          <span className="ml-1 text-[10px] text-muted-foreground">
                            {item.unitOfMeasure}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-muted-foreground">
                        {item.reorderPoint}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">
                        {formatMoney(Number(item.unitCostMinor), item.currency, "en-US")}
                      </td>
                      <td className="px-4 py-3">
                        <span className="flex flex-wrap gap-1">
                          {item.condition !== "new" ? (
                            <Badge variant="outline" className="text-[10px]">
                              {item.condition}
                            </Badge>
                          ) : null}
                          {item.hasCore ? (
                            <Badge variant="outline" className="text-[10px]">
                              core
                            </Badge>
                          ) : null}
                          {item.consumable ? (
                            <Badge variant="secondary" className="text-[10px]">
                              supply
                            </Badge>
                          ) : null}
                          {item.nonSaleable ? (
                            <Badge variant="outline" className="text-[10px]">
                              internal
                            </Badge>
                          ) : null}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{item.binLocation ?? "—"}</td>
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
