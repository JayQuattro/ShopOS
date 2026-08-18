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
