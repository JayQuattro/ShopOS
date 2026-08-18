import type { PrismaClient } from "@/generated/prisma/client";
import { assertTenantAccess, type TenantContext } from "@/modules/tenancy/policy";

export type FollowUpServiceInput = Readonly<{ db: PrismaClient; context: TenantContext }>;

export type DeclinedWorkItem = Readonly<{
  decisionId: string;
  workOrderId: string;
  workOrderNumber: string;
  workOrderStatus: string;
  customerId: string;
  customerName: string;
  assetId: string | null;
  assetName: string | null;
  description: string;
  amountMinor: string;
  currency: string;
  declinedAt: Date;
  declinedByName: string | null;
  followUpAt: Date | null;
  followUpNote: string | null;
}>;

/**
 * Declined work across the organization: estimate/change-order lines the
 * customer explicitly declined, on work orders not yet closed — the most
 * valuable re-quote list a shop has (Shopmonkey/Tekmetric's "declined jobs
 * follow-up"). Ordered oldest first so the ripest opportunities surface on top.
 */
export async function listDeclinedWork(
  input: FollowUpServiceInput,
): Promise<readonly DeclinedWorkItem[]> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.read",
  );

  const decisions = await input.db.authorizationDecision.findMany({
    where: {
      decision: "DECLINED",
      organizationId: input.context.organizationId,
      estimateLine: {
        revision: {
          workOrder: { status: { notIn: ["CLOSED", "CANCELLED"] } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
    take: 200,
    select: {
      authorizationId: true,
      estimateLineId: true,
      createdAt: true,
      authorization: {
        select: { providedByName: true, occurredAt: true },
      },
      estimateLine: {
        select: {
          description: true,
          totalMinor: true,
          estimateRevisionId: true,
          revision: {
            select: {
              currency: true,
              workOrderId: true,
              workOrder: {
                select: {
                  number: true,
                  status: true,
                  customerId: true,
                  customer: { select: { displayName: true } },
                  assetId: true,
                  asset: { select: { displayName: true } },
                },
              },
            },
          },
        },
      },
    },
  });

  return decisions.map((decision) => {
    const line = decision.estimateLine;
    return {
      decisionId: `${decision.authorizationId}:${decision.estimateLineId}`,
      workOrderId: line.revision.workOrderId,
      workOrderNumber: line.revision.workOrder.number,
      workOrderStatus: line.revision.workOrder.status,
      customerId: line.revision.workOrder.customerId,
      customerName: line.revision.workOrder.customer.displayName,
      assetId: line.revision.workOrder.assetId,
      assetName: line.revision.workOrder.asset?.displayName ?? null,
      description: line.description,
      amountMinor: line.totalMinor.toString(),
      currency: line.revision.currency,
      declinedAt: decision.authorization?.occurredAt ?? decision.createdAt,
      declinedByName: decision.authorization?.providedByName ?? null,
      followUpAt: null,
      followUpNote: null,
    };
  });
}

import { addLine } from "@/modules/estimates/estimate-service";
import { createChangeOrder, presentChangeOrder } from "@/modules/estimates/change-order-service";

export class ReQuoteFailed extends Error {
  constructor(
    public readonly reason:
      | "decision_not_found"
      | "work_order_not_authorized"
      | "change_order_pending_exists"
      | "estimate_service_error",
  ) {
    super("The re-quote operation could not be completed.");
    this.name = "ReQuoteFailed";
  }
}

/**
 * Re-quotes one declined line: copies it into a new draft change order on the
 * same work order at its original price (the one-click declined-work
 * follow-up). The shop can adjust the draft before presenting, or present
 * immediately — the standard change-order flow takes over from there.
 */
export async function reQuoteDeclinedLine(
  input: Readonly<{
    db: import("@/generated/prisma/client").PrismaClient;
    context: TenantContext;
    decisionId: string;
    present?: boolean;
  }>,
): Promise<Readonly<{ revisionId: string; changeOrderNumber: number; presented: boolean }>> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );

  const [authorizationId, lineId] = input.decisionId.split(":");
  if (!authorizationId || !lineId) throw new ReQuoteFailed("decision_not_found");

  const decision = await input.db.authorizationDecision.findFirst({
    where: {
      authorizationId,
      estimateLineId: lineId,
      decision: "DECLINED",
      organizationId: input.context.organizationId,
    },
    select: {
      estimateLine: {
        select: {
          id: true,
          description: true,
          quantityMilli: true,
          unitPriceMinor: true,
          taxable: true,
          taxRateBasisPoints: true,
          kind: true,
          serviceGroupKey: true,
          position: true,
          revision: { select: { workOrderId: true, currency: true } },
        },
      },
    },
  });
  if (!decision) throw new ReQuoteFailed("decision_not_found");
  const line = decision.estimateLine;

  let created;
  try {
    created = await createChangeOrder({
      db: input.db,
      context: input.context,
      workOrderId: line.revision.workOrderId,
      note: `Re-quote of previously declined work: ${line.description}.`,
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("pending")) {
      throw new ReQuoteFailed("change_order_pending_exists");
    }
    if (error instanceof Error && error.message.includes("authorized")) {
      throw new ReQuoteFailed("work_order_not_authorized");
    }
    throw new ReQuoteFailed("estimate_service_error");
  }

  await addLine({
    db: input.db,
    context: input.context,
    revisionId: created.revisionId,
    kind: line.kind,
    serviceGroupKey: line.serviceGroupKey,
    description: line.description,
    quantityMilli: line.quantityMilli,
    unitPriceMinor: Number(line.unitPriceMinor),
    discountMinor: 0,
    taxable: line.taxable,
    taxRateBasisPoints: line.taxRateBasisPoints,
    position: 1,
  });

  let presented = false;
  if (input.present) {
    await presentChangeOrder({
      db: input.db,
      context: input.context,
      revisionId: created.revisionId,
    });
    presented = true;
  }

  return {
    revisionId: created.revisionId,
    changeOrderNumber: created.changeOrderNumber,
    presented,
  };
}
