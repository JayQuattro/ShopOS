import { randomBytes, randomUUID } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import { assertTenantAccess, type TenantContext } from "@/modules/tenancy/policy";
import { computeTotals, type TransactionalClient } from "@/modules/estimates/estimate-service";
import { resolveLinkTtlHours } from "@/modules/estimates/authorization-link-service";

type ChangeOrderServiceInput = Readonly<{ db: PrismaClient; context: TenantContext }>;

export class ChangeOrderFailed extends Error {
  constructor(
    public readonly reason:
      | "work_order_not_found"
      | "work_order_not_authorized"
      | "revision_not_found"
      | "revision_not_change_order"
      | "revision_not_draft"
      | "revision_not_presented"
      | "revision_decided"
      | "change_order_pending_exists"
      | "baseline_not_presented"
      | "invalid_note"
      | "empty_change_order",
  ) {
    super("The change order operation could not be completed.");
    this.name = "ChangeOrderFailed";
  }
}

/** A change order is pending until every one of its lines carries a decision. */
export async function pendingChangeOrder(
  db: PrismaClient,
  input: Readonly<{ organizationId: string; workOrderId: string }>,
): Promise<{ id: string; changeOrderNumber: number | null } | null> {
  const candidates = await db.estimateRevision.findMany({
    where: {
      organizationId: input.organizationId,
      workOrderId: input.workOrderId,
      documentKind: "CHANGE_ORDER",
      status: "PRESENTED",
    },
    select: { id: true, changeOrderNumber: true },
  });
  if (candidates.length === 0) return null;

  const undecided = await db.estimateRevision.findFirst({
    where: {
      id: { in: candidates.map((c) => c.id) },
      lines: { some: { authorizationDecisions: { none: {} } } },
    },
    select: { id: true, changeOrderNumber: true },
  });
  return undecided ?? null;
}

/**
 * Creates a DRAFT change order on an authorized (or in-progress) work order.
 * The summary note explains the discovered work and is shown to the customer
 * verbatim (ADR 0014).
 */
export async function createChangeOrder(
  input: ChangeOrderServiceInput & { workOrderId: string; note: string },
): Promise<Readonly<{ revisionId: string; revisionNumber: number; changeOrderNumber: number }>> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );

  const note = input.note.trim();
  if (note.length < 3 || note.length > 1000) throw new ChangeOrderFailed("invalid_note");

  return input.db.$transaction(async (transaction) => {
    const wo = await transaction.workOrder.findFirst({
      where: { id: input.workOrderId, organizationId: input.context.organizationId },
      select: { id: true, locationId: true, status: true },
    });
    if (!wo) throw new ChangeOrderFailed("work_order_not_found");
    if (wo.status !== "AUTHORIZED" && wo.status !== "IN_PROGRESS") {
      throw new ChangeOrderFailed("work_order_not_authorized");
    }

    if (await pendingChangeOrderInTransaction(transaction, input.context.organizationId, wo.id)) {
      throw new ChangeOrderFailed("change_order_pending_exists");
    }

    // Currency and location come from the active presented baseline.
    const baseline = await transaction.estimateRevision.findFirst({
      where: {
        organizationId: input.context.organizationId,
        workOrderId: wo.id,
        documentKind: "BASELINE",
        status: "PRESENTED",
      },
      orderBy: { revisionNumber: "desc" },
      select: { currency: true },
    });
    if (!baseline) throw new ChangeOrderFailed("baseline_not_presented");

    const [latestRevision, latestChangeOrder] = await Promise.all([
      transaction.estimateRevision.findFirst({
        where: { workOrderId: wo.id },
        orderBy: { revisionNumber: "desc" },
        select: { revisionNumber: true },
      }),
      transaction.estimateRevision.findFirst({
        where: { workOrderId: wo.id, documentKind: "CHANGE_ORDER" },
        orderBy: { changeOrderNumber: "desc" },
        select: { changeOrderNumber: true },
      }),
    ]);

    const revision = await transaction.estimateRevision.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        locationId: wo.locationId,
        workOrderId: wo.id,
        revisionNumber: (latestRevision?.revisionNumber ?? 0) + 1,
        status: "DRAFT",
        documentKind: "CHANGE_ORDER",
        changeOrderNumber: (latestChangeOrder?.changeOrderNumber ?? 0) + 1,
        summaryNote: note,
        currency: baseline.currency,
        subtotalMinor: 0n,
        discountMinor: 0n,
        taxMinor: 0n,
        totalMinor: 0n,
        createdByUserId: input.context.actorId,
      },
    });

    await recordChangeOrderActivity(transaction, input.context, {
      workOrderId: wo.id,
      locationId: wo.locationId,
      eventType: "change_order.created",
      summary: `Change order ${revision.changeOrderNumber} drafted: ${note}`,
    });

    return {
      revisionId: revision.id,
      revisionNumber: revision.revisionNumber,
      changeOrderNumber: revision.changeOrderNumber!,
    };
  });
}

/**
 * Presents a change order. Unlike a baseline presentation this never touches
 * work-order status: the delta is authorized incrementally (ADR 0014).
 *
 * When the net delta is zero or negative and the organization's credit policy
 * is AUTO_APPLY, a SYSTEM authorization approving every line is recorded
 * immediately and the customer is notified rather than asked.
 */
export async function presentChangeOrder(
  input: ChangeOrderServiceInput & { revisionId: string },
): Promise<Readonly<{ autoApplied: boolean }>> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );

  return input.db.$transaction(async (transaction) => {
    const revision = await loadChangeOrder(transaction, input.context, input.revisionId);
    if (revision.status !== "DRAFT") throw new ChangeOrderFailed("revision_not_draft");

    const lines = await transaction.estimateLine.findMany({
      where: { estimateRevisionId: revision.id },
      select: { id: true },
    });
    if (lines.length === 0) throw new ChangeOrderFailed("empty_change_order");

    const totals = await computeTotals(transaction, revision.id);

    const update = await transaction.estimateRevision.updateMany({
      where: { id: revision.id, status: "DRAFT" },
      data: {
        status: "PRESENTED",
        presentedAt: new Date(),
        subtotalMinor: BigInt(totals.subtotalMinor),
        discountMinor: BigInt(totals.discountMinor),
        taxMinor: BigInt(totals.taxMinor),
        totalMinor: BigInt(totals.totalMinor),
      },
    });
    if (update.count !== 1) throw new ChangeOrderFailed("revision_not_draft");

    const org = await transaction.organization.findUnique({
      where: { id: input.context.organizationId },
      select: { changeOrderCreditPolicy: true },
    });

    const autoApply = totals.totalMinor <= 0 && org?.changeOrderCreditPolicy === "AUTO_APPLY";
    let autoApplied = false;

    if (autoApply) {
      // Reductions never increase what the customer owes: approve every line
      // with a SYSTEM authorization and notify instead of asking.
      const authorization = await transaction.authorization.create({
        data: {
          id: randomUUID(),
          organizationId: input.context.organizationId,
          estimateRevisionId: revision.id,
          method: "SYSTEM",
          providedByName: "ShopOS",
          note: "Credit change order auto-applied (net delta ≤ 0).",
          occurredAt: new Date(),
        },
      });
      for (const line of lines) {
        await transaction.authorizationDecision.create({
          data: {
            authorizationId: authorization.id,
            organizationId: input.context.organizationId,
            estimateLineId: line.id,
            decision: "APPROVED",
          },
        });
      }
      autoApplied = true;
    } else {
      // Revoke any outstanding links from earlier documents of this work order.
      await transaction.authorizationLink.updateMany({
        where: {
          organizationId: input.context.organizationId,
          revokedAt: null,
          usedAt: null,
          estimateRevision: {
            workOrderId: revision.workOrderId,
            id: { not: revision.id },
          },
        },
        data: { revokedAt: new Date() },
      });

      const ttlHours = await resolveLinkTtlHours(transaction, input.context.organizationId);
      await transaction.authorizationLink.create({
        data: {
          id: randomUUID(),
          organizationId: input.context.organizationId,
          estimateRevisionId: revision.id,
          token: randomBytes(32).toString("base64url"),
          expiresAt: new Date(Date.now() + ttlHours * 60 * 60 * 1000),
        },
      });
    }

    await recordChangeOrderActivity(transaction, input.context, {
      workOrderId: revision.workOrderId,
      locationId: revision.locationId,
      eventType: "change_order.presented",
      summary: autoApplied
        ? `Change order ${revision.changeOrderNumber} applied (net ${totals.totalMinor <= 0 ? "reduction" : "increase"}).`
        : `Change order ${revision.changeOrderNumber} presented for customer authorization.`,
    });

    await transaction.auditEvent.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        locationId: revision.locationId,
        actorUserId: input.context.actorId,
        action: "change_order.presented",
        entityType: "estimate_revision",
        entityId: revision.id,
        requestId: input.context.requestId,
        after: {
          changeOrderNumber: revision.changeOrderNumber,
          totalMinor: totals.totalMinor,
          autoApplied,
        },
      },
    });

    // The customer notification (and, for approvals, the link email) is sent by
    // the outbox handler, which branches on document kind and auto-application.
    await transaction.outboxEvent.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        eventType: "estimate.presented",
        aggregateType: "estimate_revision",
        aggregateId: revision.id,
        payload: {
          revisionId: revision.id,
          workOrderId: revision.workOrderId,
          locationId: revision.locationId,
        },
      },
    });

    return { autoApplied };
  });
}

/**
 * Voids an undecided change order: marks it VOIDED and revokes its links.
 * Presented documents with any recorded decision are history and cannot be
 * voided.
 */
export async function voidChangeOrder(
  input: ChangeOrderServiceInput & { revisionId: string },
): Promise<void> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );

  await input.db.$transaction(async (transaction) => {
    const revision = await loadChangeOrder(transaction, input.context, input.revisionId);
    if (revision.status !== "PRESENTED") throw new ChangeOrderFailed("revision_not_presented");

    const decided = await transaction.authorizationDecision.findFirst({
      where: { estimateLine: { estimateRevisionId: revision.id } },
      select: { authorizationId: true },
    });
    if (decided) throw new ChangeOrderFailed("revision_decided");

    const update = await transaction.estimateRevision.updateMany({
      where: { id: revision.id, status: "PRESENTED" },
      data: { status: "VOIDED" },
    });
    if (update.count !== 1) throw new ChangeOrderFailed("revision_not_presented");

    await transaction.authorizationLink.updateMany({
      where: {
        organizationId: input.context.organizationId,
        estimateRevisionId: revision.id,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });

    await recordChangeOrderActivity(transaction, input.context, {
      workOrderId: revision.workOrderId,
      locationId: revision.locationId,
      eventType: "change_order.voided",
      summary: `Change order ${revision.changeOrderNumber} voided before a decision was recorded.`,
    });

    await transaction.auditEvent.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        locationId: revision.locationId,
        actorUserId: input.context.actorId,
        action: "change_order.voided",
        entityType: "estimate_revision",
        entityId: revision.id,
        requestId: input.context.requestId,
      },
    });
  });
}

/**
 * Re-issues the authorization link on a still-pending document (baseline or
 * change order) and re-enqueues the customer email. Resending never creates a
 * new document (ADR 0014).
 */
export async function resendAuthorizationLink(
  input: ChangeOrderServiceInput & { revisionId: string },
): Promise<void> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "estimates.present",
  );

  await input.db.$transaction(async (transaction) => {
    const revision = await transaction.estimateRevision.findFirst({
      where: { id: input.revisionId, organizationId: input.context.organizationId },
      select: {
        id: true,
        workOrderId: true,
        locationId: true,
        status: true,
        changeOrderNumber: true,
      },
    });
    if (!revision) throw new ChangeOrderFailed("revision_not_found");
    if (revision.status !== "PRESENTED") throw new ChangeOrderFailed("revision_not_presented");

    await transaction.authorizationLink.updateMany({
      where: {
        organizationId: input.context.organizationId,
        estimateRevisionId: revision.id,
        revokedAt: null,
        usedAt: null,
      },
      data: { revokedAt: new Date() },
    });

    const ttlHours = await resolveLinkTtlHours(transaction, input.context.organizationId);
    await transaction.authorizationLink.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        estimateRevisionId: revision.id,
        token: randomBytes(32).toString("base64url"),
        expiresAt: new Date(Date.now() + ttlHours * 60 * 60 * 1000),
      },
    });

    await recordChangeOrderActivity(transaction, input.context, {
      workOrderId: revision.workOrderId,
      locationId: revision.locationId,
      eventType: "authorization.link_resent",
      summary: "Authorization link re-issued.",
    });

    await transaction.outboxEvent.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        eventType: "estimate.presented",
        aggregateType: "estimate_revision",
        aggregateId: revision.id,
        payload: {
          revisionId: revision.id,
          workOrderId: revision.workOrderId,
          locationId: revision.locationId,
        },
      },
    });
  });
}

export type AuthorizedTotals = Readonly<{
  currency: string;
  baselineApprovedMinor: number;
  changeOrdersApprovedMinor: number;
  cumulativeApprovedMinor: number;
}>;

/**
 * Cumulative authorized scope (ADR 0014): approved lines of the active
 * presented baseline plus approved lines of every presented change order.
 * Credit lines contribute negative amounts.
 */
export async function getAuthorizedTotals(
  db: PrismaClient,
  input: Readonly<{ organizationId: string; workOrderId: string }>,
): Promise<AuthorizedTotals | null> {
  const baseline = await db.estimateRevision.findFirst({
    where: {
      organizationId: input.organizationId,
      workOrderId: input.workOrderId,
      documentKind: "BASELINE",
      status: "PRESENTED",
    },
    orderBy: { revisionNumber: "desc" },
    select: {
      id: true,
      currency: true,
      lines: {
        select: {
          totalMinor: true,
          authorizationDecisions: { select: { decision: true }, take: 1 },
        },
      },
    },
  });
  if (!baseline) return null;

  const changeOrders = await db.estimateRevision.findMany({
    where: {
      organizationId: input.organizationId,
      workOrderId: input.workOrderId,
      documentKind: "CHANGE_ORDER",
      status: "PRESENTED",
    },
    select: {
      lines: {
        select: {
          totalMinor: true,
          authorizationDecisions: { select: { decision: true }, take: 1 },
        },
      },
    },
  });

  const approvedTotal = (
    lines: ReadonlyArray<
      Readonly<{
        totalMinor: bigint;
        authorizationDecisions: ReadonlyArray<{ decision: string }>;
      }>
    >,
  ): number =>
    lines
      .filter((line) => line.authorizationDecisions[0]?.decision === "APPROVED")
      .reduce((sum, line) => sum + Number(line.totalMinor), 0);

  const baselineApprovedMinor = approvedTotal(baseline.lines);
  const changeOrdersApprovedMinor = changeOrders.reduce(
    (sum, co) => sum + approvedTotal(co.lines),
    0,
  );

  return {
    currency: baseline.currency,
    baselineApprovedMinor,
    changeOrdersApprovedMinor,
    cumulativeApprovedMinor: baselineApprovedMinor + changeOrdersApprovedMinor,
  };
}

// --- Helpers ---

async function pendingChangeOrderInTransaction(
  transaction: TransactionalClient,
  organizationId: string,
  workOrderId: string,
): Promise<boolean> {
  const pending = await transaction.estimateRevision.findFirst({
    where: {
      organizationId,
      workOrderId,
      documentKind: "CHANGE_ORDER",
      status: "PRESENTED",
      lines: { some: { authorizationDecisions: { none: {} } } },
    },
    select: { id: true },
  });
  return pending !== null;
}

async function loadChangeOrder(
  transaction: TransactionalClient,
  context: TenantContext,
  revisionId: string,
) {
  const revision = await transaction.estimateRevision.findFirst({
    where: { id: revisionId, organizationId: context.organizationId },
    select: {
      id: true,
      workOrderId: true,
      locationId: true,
      revisionNumber: true,
      changeOrderNumber: true,
      status: true,
    },
  });
  if (!revision) throw new ChangeOrderFailed("revision_not_found");
  if (revision.changeOrderNumber === null) {
    throw new ChangeOrderFailed("revision_not_change_order");
  }
  return revision;
}

async function recordChangeOrderActivity(
  transaction: TransactionalClient,
  context: TenantContext,
  input: Readonly<{
    workOrderId: string;
    locationId: string;
    eventType: string;
    summary: string;
  }>,
): Promise<void> {
  await transaction.activityEvent.create({
    data: {
      id: randomUUID(),
      organizationId: context.organizationId,
      locationId: input.locationId,
      workOrderId: input.workOrderId,
      actorUserId: context.actorId,
      eventType: input.eventType,
      summary: input.summary,
    },
  });
}
