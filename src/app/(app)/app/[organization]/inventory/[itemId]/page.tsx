import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/shopos/page-header";
import { PageSection } from "@/components/shopos/section";
import { RecordList, RecordListRow } from "@/components/shopos/record-list";
import { EmptyState } from "@/components/shopos/states";
import { db } from "@/db/client";
import { humanizeToken } from "@/lib/labels";
import { formatDate, formatDateTime, formatMoney } from "@/i18n/formatters";
import { listMovements } from "@/modules/inventory/inventory-service";
import { listPurchaseHistory } from "@/modules/parts/part-order-service";
import { getRequestContext } from "@/modules/tenancy/request-context";

export const dynamic = "force-dynamic";

const MOVEMENT_LABELS: Readonly<Record<string, string>> = {
  RECEIVED: "Received",
  ISSUED_TO_JOB: "Issued to job",
  MANUAL_ADJUSTMENT: "Adjustment",
  RETURNED_TO_STOCK: "To stock",
};

/**
 * One stocked part, end to end: identity and cost, live on-hand against the
 * reorder point, the append-only movement ledger (where stock came from and
 * where it went, linked to the work order), and purchase history.
 */
export default async function InventoryItemPage({
  params,
}: {
  params: Promise<{ organization: string; itemId: string }>;
}) {
  const { organization, itemId } = await params;
  const context = await getRequestContext(organization);
  if (context.organizationId !== organization) {
    return <p className="text-destructive">Organization context mismatch.</p>;
  }

  const item = await db.inventoryItem.findFirst({
    where: { id: itemId, organizationId: context.organizationId },
    include: {
      location: { select: { name: true } },
      category: { select: { name: true } },
    },
  });

  if (!item) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-sm text-muted-foreground">Part not found.</p>
          <Link
            href={`/app/${context.organizationId}/inventory`}
            className="text-link underline-offset-4 hover:underline"
          >
            ← Back to inventory
          </Link>
        </CardContent>
      </Card>
    );
  }

  const [movements, purchases] = await Promise.all([
    listMovements({ db, context, itemId: item.id, take: 50 }),
    listPurchaseHistory({ db, context, inventoryItemId: item.id }),
  ]);

  const money = (minor: string | bigint) => formatMoney(Number(minor), item.currency, "en-US");
  const low = item.quantityOnHand <= item.reorderPoint;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={item.name}
        description={[item.partNumber, item.brand, humanizeToken(item.condition)]
          .filter(Boolean)
          .join(" · ")}
        breadcrumbs={[
          { label: "Inventory", href: `/app/${context.organizationId}/inventory` },
          { label: item.partNumber },
        ]}
      />

      <PageSection id="overview" title="Part">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardContent className="py-4">
              <p className="text-xs text-muted-foreground">On hand</p>
              <p className="mt-1 font-mono text-2xl tabular-nums">
                {item.quantityOnHand}
                {item.unitOfMeasure ? (
                  <span className="text-sm text-muted-foreground"> {item.unitOfMeasure}</span>
                ) : null}
              </p>
              {low ? (
                <Badge variant="destructive" className="mt-2 text-[10px]">
                  at/below reorder point ({item.reorderPoint})
                </Badge>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">Reorder at {item.reorderPoint}</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <p className="text-xs text-muted-foreground">Unit cost</p>
              <p className="mt-1 text-2xl font-medium">{money(item.unitCostMinor)}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Stock value ≈ {money(item.unitCostMinor * BigInt(item.quantityOnHand))}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <p className="text-xs text-muted-foreground">Location</p>
              <p className="mt-1 text-sm font-medium">{item.location?.name ?? "—"}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {item.binLocation ? `Bin ${item.binLocation}` : "No bin"}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <p className="text-xs text-muted-foreground">Identity</p>
              <p className="mt-1 text-sm font-medium">
                {item.oeNumber ? `OE ${item.oeNumber}` : "No OE number"}
              </p>
              <p className="mt-1 flex flex-wrap gap-1 text-xs text-muted-foreground">
                {item.category ? <span>{item.category.name}</span> : null}
                {item.hasCore ? <span>· core {money(item.coreValueMinor ?? 0n)}</span> : null}
                {item.consumable ? <span>· supply</span> : null}
                {item.nonSaleable ? <span>· internal</span> : null}
                {item.uomGroup && item.uomFactorMilli ? (
                  <span>
                    · {item.uomGroup} ×{(item.uomFactorMilli / 1000).toString()}
                  </span>
                ) : null}
              </p>
            </CardContent>
          </Card>
        </div>
      </PageSection>

      <PageSection
        id="movements"
        title="Stock movements"
        description="Every change is recorded — receiving, issues to jobs, and corrections. Append-only."
      >
        {movements.length === 0 ? (
          <EmptyState
            title="No movements recorded"
            description="Receiving this part into stock or adjusting its count will show here."
          />
        ) : (
          <RecordList>
            {movements.map((movement) => (
              <RecordListRow
                key={movement.id}
                title={
                  movement.workOrderNumber
                    ? `${MOVEMENT_LABELS[movement.reason] ?? movement.reason} · ${movement.workOrderNumber}`
                    : (MOVEMENT_LABELS[movement.reason] ?? humanizeToken(movement.reason))
                }
                description={
                  [
                    movement.note,
                    movement.createdByName,
                    formatDateTime(movement.createdAt, "UTC", "en-US"),
                  ]
                    .filter(Boolean)
                    .join(" · ") || undefined
                }
                {...(movement.workOrderId
                  ? { href: `/app/${context.organizationId}/work-orders/${movement.workOrderId}` }
                  : {})}
                trailing={
                  <span
                    className={`font-mono text-sm font-semibold tabular-nums ${
                      movement.delta > 0 ? "text-primary" : "text-destructive"
                    }`}
                  >
                    {movement.delta > 0 ? `+${movement.delta}` : movement.delta}
                  </span>
                }
              />
            ))}
          </RecordList>
        )}
      </PageSection>

      <PageSection id="purchases" title="Purchase history" description="Where this part came from.">
        {purchases.length === 0 ? (
          <EmptyState
            title="Not ordered yet"
            description="Part orders carrying this part number will be listed here."
          />
        ) : (
          <RecordList>
            {purchases.map((purchase, index) => (
              <RecordListRow
                key={`${purchase.orderedAt?.toISOString() ?? "unordered"}-${index}`}
                title={purchase.supplierName}
                description={[
                  purchase.orderedAt
                    ? formatDate(purchase.orderedAt, "UTC", "en-US")
                    : "Not ordered",
                  humanizeToken(purchase.purpose),
                ]
                  .filter(Boolean)
                  .join(" · ")}
                trailing={
                  <span className="text-sm text-muted-foreground">
                    ×{purchase.quantity} · {money(purchase.unitCostMinor)}
                  </span>
                }
              />
            ))}
          </RecordList>
        )}
      </PageSection>

      {item.notes ? (
        <PageSection id="notes" title="Notes">
          <p className="text-sm text-muted-foreground">{item.notes}</p>
        </PageSection>
      ) : null}
    </div>
  );
}
