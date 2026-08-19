import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import { createChangeOrder } from "@/modules/estimates/change-order-service";
import { addLine as addRevisionLine } from "@/modules/estimates/estimate-service";
import { assertTenantAccess, type TenantContext } from "@/modules/tenancy/policy";

export type RecommendBridgeInput = Readonly<{ db: PrismaClient; context: TenantContext }>;

export class RecommendBridgeFailed extends Error {
  constructor(
    public readonly reason:
      "item_not_found" | "item_not_recommended" | "work_order_not_ready" | "change_order_failed",
  ) {
    super("The recommendation could not be bridged to the estimate.");
    this.name = "RecommendBridgeFailed";
  }
}

/**
 * The inspection→estimate bridge (ADR 0018): turns a REPLACE-verdict
 * checklist row into a change-order line, carrying the item's photos with
 * it so the customer sees the evidence next to the price they're approving.
 * The description names the component and zone; pricing starts at zero for
 * the advisor to fill from the catalog — a recommendation is not a quote.
 */
export async function recommendInspectionItemToEstimate(
  input: RecommendBridgeInput & { inspectionItemId: string },
): Promise<Readonly<{ revisionId: string; lineId: string }>> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );

  const item = await input.db.inspectionItem.findFirst({
    where: { id: input.inspectionItemId, organizationId: input.context.organizationId },
    select: {
      id: true,
      zone: true,
      component: true,
      condition: true,
      note: true,
      inspection: { select: { workOrderId: true, title: true, locationId: true } },
      attachments: { select: { id: true } },
    },
  });
  if (!item) throw new RecommendBridgeFailed("item_not_found");
  if (item.condition !== "REPLACE") throw new RecommendBridgeFailed("item_not_recommended");

  const description = `Recommended from inspection — ${item.zone ? `${item.zone}: ` : ""}${item.component}`;

  let revisionId: string;
  try {
    const created = await createChangeOrder({
      db: input.db,
      context: input.context,
      workOrderId: item.inspection.workOrderId,
      note: `Recommended from inspection "${item.inspection.title}"${item.note ? `: ${item.note}` : "."}`,
    });
    revisionId = created.revisionId;
  } catch {
    throw new RecommendBridgeFailed("change_order_failed");
  }

  const line = await addRevisionLine({
    db: input.db,
    context: input.context,
    revisionId,
    serviceGroupKey: "inspection-recommendation",
    kind: "PART",
    description,
    quantityMilli: 1000,
    unitPriceMinor: 0,
    discountMinor: 0,
    taxable: true,
    taxRateBasisPoints: 0,
    position: 1,
  });

  // The evidence follows the recommendation: the item's photos anchor to
  // the new estimate line so the authorization page shows them beside it.
  if (item.attachments.length > 0) {
    const createdLine = await input.db.estimateLine.findFirst({
      where: { id: line.lineId, organizationId: input.context.organizationId },
      select: { id: true, estimateRevisionId: true },
    });
    if (createdLine) {
      await input.db.workOrderAttachment.updateMany({
        where: {
          id: { in: item.attachments.map((attachment) => attachment.id) },
          organizationId: input.context.organizationId,
        },
        data: {
          estimateLineId: createdLine.id,
          estimateRevisionId: createdLine.estimateRevisionId,
        },
      });
    }
  }

  await input.db.activityEvent.create({
    data: {
      id: randomUUID(),
      organizationId: input.context.organizationId,
      locationId: item.inspection.locationId,
      workOrderId: item.inspection.workOrderId,
      actorUserId: input.context.actorId,
      eventType: "inspection.recommended",
      summary: `Inspection recommendation added as change-order line: ${item.component}.`,
    },
  });

  return { revisionId, lineId: line.lineId };
}
