import { randomBytes, randomUUID } from "node:crypto";

import type { PrismaClient, PricedLineKind } from "@/generated/prisma/client";
import { calculateLine, currencyCode, type PricedLineInput } from "@/modules/shared/money";
import { computeStackedTax, resolveTaxComponents } from "@/modules/taxes/tax-stacks";
import { assertTenantAccess, type TenantContext } from "@/modules/tenancy/policy";
import { releaseActiveReservations } from "@/modules/inventory/inventory-service";
import { transitionStatus } from "@/modules/work-orders/work-order-service";
import { resolveLinkTtlHours } from "@/modules/estimates/authorization-link-service";
import { feeLinesForPresentation } from "@/modules/taxes/shop-fee-service";

export type TransactionalClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$use" | "$extends"
>;

export type EstimateServiceInput = Readonly<{ db: PrismaClient; context: TenantContext }>;

export class EstimateFailed extends Error {
  constructor(
    public readonly reason:
      | "work_order_not_found"
      | "revision_not_found"
      | "revision_not_draft"
      | "tax_rate_not_found"
      | "line_not_found"
      | "invalid_currency"
      | "credit_line_not_allowed"
      | "revision_not_baseline"
      | "revision_decided"
      | "invalid_option_group"
      | "items_mismatch"
      | "group_name_conflict"
      | "invalid_group_label",
  ) {
    super("The estimate operation could not be completed.");
    this.name = "EstimateFailed";
  }
}

/**
 * Creates a new DRAFT estimate revision for a work order. The revision number
 * is auto-incremented (1, 2, 3…). The org/location are derived from the work
 * order (verified in the same tenant).
 */
export async function createDraftRevision(
  input: EstimateServiceInput & { workOrderId: string; currency: string },
): Promise<Readonly<{ revisionId: string; revisionNumber: number }>> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );

  if (!/^[A-Z]{3}$/.test(input.currency)) {
    throw new EstimateFailed("invalid_currency");
  }

  return input.db.$transaction(async (transaction) => {
    const wo = await transaction.workOrder.findFirst({
      where: { id: input.workOrderId, organizationId: input.context.organizationId },
      select: { id: true, locationId: true },
    });
    if (!wo) throw new EstimateFailed("work_order_not_found");

    const latestRevision = await transaction.estimateRevision.findFirst({
      where: { workOrderId: wo.id },
      orderBy: { revisionNumber: "desc" },
      select: { revisionNumber: true },
    });
    const nextNumber = (latestRevision?.revisionNumber ?? 0) + 1;

    const org = await transaction.organization.findUnique({
      where: { id: input.context.organizationId },
      select: { taxDisplayMode: true },
    });

    const revision = await transaction.estimateRevision.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        locationId: wo.locationId,
        workOrderId: wo.id,
        revisionNumber: nextNumber,
        status: "DRAFT",
        currency: input.currency,
        subtotalMinor: 0n,
        discountMinor: 0n,
        taxMinor: 0n,
        totalMinor: 0n,
        // Snapshot the org's pricing convention (VAT-inclusive vs added).
        taxInclusive: org?.taxDisplayMode === "INCLUSIVE",
        createdByUserId: input.context.actorId,
      },
    });

    return { revisionId: revision.id, revisionNumber: revision.revisionNumber };
  });
}

/**
 * Adds a priced line to a DRAFT revision. Financial fields are computed by the
 * money kernel. Once a revision is PRESENTED, lines cannot be added.
 */
export async function addLine(
  input: EstimateServiceInput & {
    revisionId: string;
    kind: PricedLineKind;
    serviceGroupKey: string;
    description: string;
    quantityMilli: number;
    unitPriceMinor: number;
    discountMinor: number;
    taxable: boolean;
    taxRateBasisPoints: number;
    taxRateId?: string;
    position: number;
    /** Job grouping on the document ("Front brakes"); label rides for display. */
    serviceGroupLabel?: string;
    /** Lines sharing an option group key are alternatives: the customer picks one. */
    optionGroupKey?: string;
    optionGroupLabel?: string;
  },
): Promise<Readonly<{ lineId: string }>> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );

  // Option groups carry both a key (grouping) and a label (display) or neither.
  if (Boolean(input.optionGroupKey) !== Boolean(input.optionGroupLabel)) {
    throw new EstimateFailed("invalid_option_group");
  }

  // Compute financial fields using the pure money kernel.
  return input.db.$transaction(async (transaction) => {
    const revision = await loadRevisionForMutation(transaction, input.context, input.revisionId);
    if (revision.status !== "DRAFT") throw new EstimateFailed("revision_not_draft");

    // A named tax rate may resolve to a stack (GST + PST/QST): the group's
    // rates share one base, round per component, and sum to the line's tax.
    let taxRateBasisPoints = input.taxRateBasisPoints;
    let taxComponents: Parameters<typeof computeStackedTax>[1] | null = null;
    if (input.taxRateId && input.taxable) {
      const components = await resolveTaxComponents(
        transaction,
        input.context.organizationId,
        input.taxRateId,
      );
      if (!components) throw new EstimateFailed("tax_rate_not_found");
      taxRateBasisPoints = computeStackedTax(0, components).effectiveBasisPoints;
      taxComponents = components;
    }

    // The line's price convention follows the revision's snapshot — set at
    // revision creation from the org's tax display mode, never re-read live.
    const calculated = calculateLine({
      id: "temp",
      kind: input.kind as PricedLineInput["kind"],
      quantityMilli: input.quantityMilli,
      unitPriceMinor: input.unitPriceMinor,
      discountMinor: input.discountMinor,
      taxable: input.taxable,
      taxRateBasisPoints,
      authorization: "pending",
      taxMode: revision.taxInclusive ? "INCLUSIVE" : "EXCLUSIVE",
    });

    // Component amounts for display, computed on this line's actual net.
    const componentBreakdown = taxComponents
      ? computeStackedTax(calculated.netMinor, taxComponents)
      : null;

    // Credit lines (negative unit price) exist only on change orders (ADR 0014).
    if (input.unitPriceMinor < 0 && revision.documentKind !== "CHANGE_ORDER") {
      throw new EstimateFailed("credit_line_not_allowed");
    }

    const line = await transaction.estimateLine.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        estimateRevisionId: revision.id,
        serviceGroupKey: input.serviceGroupKey,
        ...(input.serviceGroupLabel ? { serviceGroupLabel: input.serviceGroupLabel } : {}),
        ...(input.optionGroupKey ? { optionGroupKey: input.optionGroupKey } : {}),
        ...(input.optionGroupLabel ? { optionGroupLabel: input.optionGroupLabel } : {}),
        kind: input.kind,
        description: input.description,
        quantityMilli: input.quantityMilli,
        unitPriceMinor: BigInt(input.unitPriceMinor),
        grossMinor: BigInt(calculated.grossMinor),
        discountMinor: BigInt(input.discountMinor),
        taxable: input.taxable,
        taxRateBasisPoints,
        taxMinor: BigInt(calculated.taxMinor),
        taxInclusive: revision.taxInclusive,
        ...(componentBreakdown ? { taxComponents: componentBreakdown.breakdown } : {}),
        totalMinor: BigInt(calculated.totalMinor),
        position: input.position,
      },
    });

    // Recompute revision totals.
    await recomputeTotals(transaction, revision.id);

    return { lineId: line.id };
  });
}

/**
 * Reorders draft lines and moves them between job groups. The payload is the
 * complete ordered list (lineId plus destination serviceGroupKey); positions
 * are reassigned 1..N to match. Destination labels resolve from lines already
 * in that group, so a dragged line inherits the group's display name.
 */
export async function reorderLines(
  input: EstimateServiceInput & {
    revisionId: string;
    items: ReadonlyArray<
      Readonly<{
        lineId: string;
        serviceGroupKey: string;
        serviceGroupLabel?: string | undefined;
      }>
    >;
  },
): Promise<void> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );

  await input.db.$transaction(async (transaction) => {
    const revision = await loadRevisionForMutation(transaction, input.context, input.revisionId);
    if (revision.status !== "DRAFT") throw new EstimateFailed("revision_not_draft");

    const existing = await transaction.estimateLine.findMany({
      where: {
        organizationId: input.context.organizationId,
        estimateRevisionId: revision.id,
      },
      select: { id: true, serviceGroupKey: true, serviceGroupLabel: true },
    });
    const existingIds = new Set(existing.map((line) => line.id));
    const itemIds = input.items.map((item) => item.lineId);

    // The payload must be exactly the revision's lines — no dupes, none missing.
    if (
      itemIds.length !== existing.length ||
      new Set(itemIds).size !== itemIds.length ||
      itemIds.some((id) => !existingIds.has(id))
    ) {
      throw new EstimateFailed("items_mismatch");
    }

    // Destination labels come from lines already in each destination group.
    const labelByKey = new Map<string, string>();
    for (const line of existing) {
      if (line.serviceGroupLabel && !labelByKey.has(line.serviceGroupKey)) {
        labelByKey.set(line.serviceGroupKey, line.serviceGroupLabel);
      }
    }

    // Two-phase reposition: park everything far out of range first so the
    // (revision, position) unique constraint never collides mid-update.
    let parked = 0;
    for (const line of existing) {
      parked += 1;
      await transaction.estimateLine.update({
        where: { id: line.id },
        data: { position: 100_000 + parked },
      });
    }
    let position = 0;
    for (const item of input.items) {
      position += 1;
      // Explicit labels win (a drop into a fresh group names it); otherwise
      // the destination's existing label is inherited.
      const label = item.serviceGroupLabel ?? labelByKey.get(item.serviceGroupKey) ?? null;
      await transaction.estimateLine.update({
        where: { id: item.lineId },
        data: {
          position,
          serviceGroupKey: item.serviceGroupKey,
          serviceGroupLabel: label,
        },
      });
    }

    await recomputeTotals(transaction, revision.id);
  });
}

/**
 * Renames a job group on a draft revision: every line in the group moves to
 * the new slugified key and carries the new label.
 */
export async function renameServiceGroup(
  input: EstimateServiceInput & { revisionId: string; key: string; label: string },
): Promise<Readonly<{ key: string }>> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );

  const label = input.label.trim();
  if (label.length < 1 || label.length > 160) throw new EstimateFailed("invalid_group_label");

  return input.db.$transaction(async (transaction) => {
    const revision = await loadRevisionForMutation(transaction, input.context, input.revisionId);
    if (revision.status !== "DRAFT") throw new EstimateFailed("revision_not_draft");

    const newKey = label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (newKey.length < 1) throw new EstimateFailed("invalid_group_label");

    if (newKey !== input.key) {
      const clash = await transaction.estimateLine.findFirst({
        where: {
          estimateRevisionId: revision.id,
          serviceGroupKey: newKey,
        },
        select: { id: true },
      });
      if (clash) throw new EstimateFailed("group_name_conflict");
    }

    await transaction.estimateLine.updateMany({
      where: {
        organizationId: input.context.organizationId,
        estimateRevisionId: revision.id,
        serviceGroupKey: input.key,
      },
      data: { serviceGroupKey: newKey, serviceGroupLabel: label },
    });

    return { key: newKey };
  });
}

/**
 * Removes a line from a DRAFT revision.
 */
export async function removeLine(
  input: EstimateServiceInput & { revisionId: string; lineId: string },
): Promise<void> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );

  await input.db.$transaction(async (transaction) => {
    const revision = await loadRevisionForMutation(transaction, input.context, input.revisionId);
    if (revision.status !== "DRAFT") throw new EstimateFailed("revision_not_draft");

    const deleted = await transaction.estimateLine.deleteMany({
      where: {
        id: input.lineId,
        organizationId: input.context.organizationId,
        estimateRevisionId: revision.id,
      },
    });
    if (deleted.count !== 1) throw new EstimateFailed("line_not_found");

    await recomputeTotals(transaction, revision.id);
  });
}

/**
 * Presents (seals) a DRAFT revision. This is the immutability boundary:
 * after presenting, the revision and its lines cannot be edited. Computes
 * final totals, sets status PRESENTED + presentedAt, and transitions the
 * work order to AWAITING_AUTHORIZATION.
 */
export async function presentRevision(
  input: EstimateServiceInput & { revisionId: string; expiresAt?: Date },
): Promise<void> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );

  await input.db.$transaction(async (transaction) => {
    const revision = await loadRevisionForMutation(transaction, input.context, input.revisionId);
    if (revision.status !== "DRAFT") throw new EstimateFailed("revision_not_draft");
    if (revision.documentKind === "CHANGE_ORDER") {
      throw new EstimateFailed("revision_not_baseline");
    }

    // Auto-apply active shop fees (Settings → Fees) before sealing.
    const feeLines = await feeLinesForPresentation(transaction, {
      organizationId: input.context.organizationId,
      workOrderId: revision.workOrderId,
      revisionId: revision.id,
      documentKind: "BASELINE",
      nextPosition: await nextRevisionLinePosition(transaction, revision.id),
    });
    for (const fee of feeLines) {
      if (fee.existing) continue;
      const calculated = calculateLine({
        id: `fee-${fee.position}`,
        kind: "fee",
        quantityMilli: 1000,
        unitPriceMinor: fee.unitPriceMinor,
        discountMinor: 0,
        taxable: fee.taxable,
        taxRateBasisPoints: fee.taxRateBasisPoints,
        authorization: "pending",
        taxMode: revision.taxInclusive ? "INCLUSIVE" : "EXCLUSIVE",
      });
      await transaction.estimateLine.create({
        data: {
          id: randomUUID(),
          organizationId: input.context.organizationId,
          estimateRevisionId: revision.id,
          serviceGroupKey: "shop-fee",
          kind: "FEE",
          description: fee.name,
          quantityMilli: 1000,
          unitPriceMinor: BigInt(fee.unitPriceMinor),
          grossMinor: BigInt(calculated.grossMinor),
          discountMinor: 0n,
          taxable: fee.taxable,
          taxRateBasisPoints: fee.taxRateBasisPoints,
          taxMinor: BigInt(calculated.taxMinor),
          taxInclusive: revision.taxInclusive,
          totalMinor: BigInt(calculated.totalMinor),
          position: fee.position,
        },
      });
    }

    // Recompute totals one final time.
    const totals = await computeTotals(transaction, revision.id);

    const update = await transaction.estimateRevision.updateMany({
      where: { id: revision.id, status: "DRAFT" },
      data: {
        status: "PRESENTED",
        presentedAt: new Date(),
        ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
        subtotalMinor: BigInt(totals.subtotalMinor),
        discountMinor: BigInt(totals.discountMinor),
        taxMinor: BigInt(totals.taxMinor),
        totalMinor: BigInt(totals.totalMinor),
      },
    });
    if (update.count !== 1) throw new EstimateFailed("revision_not_draft");

    // Activity event on the work order.
    await transaction.activityEvent.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        locationId: revision.locationId,
        workOrderId: revision.workOrderId,
        actorUserId: input.context.actorId,
        eventType: "estimate.presented",
        summary: `Estimate revision ${revision.revisionNumber} presented.`,
      },
    });

    // Tenant audit.
    await transaction.auditEvent.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        locationId: revision.locationId,
        actorUserId: input.context.actorId,
        action: "estimate.presented",
        entityType: "estimate_revision",
        entityId: revision.id,
        requestId: input.context.requestId,
        after: { revisionNumber: revision.revisionNumber, totalMinor: totals.totalMinor },
      },
    });

    // Revoke outstanding links from earlier revisions of this work order so the
    // customer can only act on the newest presented estimate.
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

    // Auto-issue the customer authorization link for this revision (org TTL).
    const ttlHours = await resolveLinkTtlHours(transaction, input.context.organizationId);
    const token = randomBytes(32).toString("base64url");
    await transaction.authorizationLink.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        estimateRevisionId: revision.id,
        token,
        expiresAt: new Date(Date.now() + ttlHours * 60 * 60 * 1000),
      },
    });

    // Enqueue the customer notification through the transactional outbox.
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

  // Transition the work order toward AWAITING_AUTHORIZATION. If the work order
  // is still in DRAFT, first move it to ESTIMATING so the state machine allows
  // reaching AWAITING_AUTHORIZATION.
  const revision = await input.db.estimateRevision.findUnique({
    where: { id: input.revisionId },
    select: { workOrderId: true },
  });
  if (revision) {
    const wo = await input.db.workOrder.findUnique({
      where: { id: revision.workOrderId },
      select: { status: true },
    });
    if (wo && wo.status === "DRAFT") {
      await transitionStatus({
        db: input.db,
        context: input.context,
        workOrderId: revision.workOrderId,
        targetStatus: "ESTIMATING",
      }).catch(() => undefined);
    }
    // Re-presenting after a supersede leaves the work order already in
    // AWAITING_AUTHORIZATION; the state machine forbids self-transitions.
    if (wo && wo.status !== "AWAITING_AUTHORIZATION") {
      await transitionStatus({
        db: input.db,
        context: input.context,
        workOrderId: revision.workOrderId,
        targetStatus: "AWAITING_AUTHORIZATION",
      });
    }
  }
}

/**
 * Creates a new DRAFT revision linked to the old one via supersedesRevisionId,
 * and marks the old revision SUPERSEDED. Allows re-estimation after presentation.
 */
export async function supersedeRevision(
  input: EstimateServiceInput & { revisionId: string },
): Promise<Readonly<{ newRevisionId: string; newRevisionNumber: number }>> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );

  return input.db.$transaction(async (transaction) => {
    const oldRevision = await loadRevisionForMutation(transaction, input.context, input.revisionId);
    if (oldRevision.status !== "PRESENTED") throw new EstimateFailed("revision_not_draft");

    // Superseding is pre-authorization correction (ADR 0014): once any line of
    // the revision carries a decision, the document is history.
    const decidedLines = await transaction.authorizationDecision.findFirst({
      where: {
        estimateLine: { estimateRevisionId: oldRevision.id },
      },
      select: { authorizationId: true },
    });
    if (decidedLines) throw new EstimateFailed("revision_decided");

    // Mark old revision as superseded. Holds tied to its lines are
    // released — the re-estimate re-holds what it still needs.
    await transaction.estimateRevision.update({
      where: { id: oldRevision.id },
      data: { status: "SUPERSEDED" },
    });
    const oldLineIds = await transaction.estimateLine.findMany({
      where: {
        organizationId: input.context.organizationId,
        estimateRevisionId: oldRevision.id,
      },
      select: { id: true },
    });
    if (oldLineIds.length > 0) {
      await releaseActiveReservations(
        transaction,
        input.context,
        { estimateLineIds: oldLineIds.map((line) => line.id) },
        "Released: estimate superseded",
      );
    }

    const nextNumber = oldRevision.revisionNumber + 1;
    const newRevision = await transaction.estimateRevision.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        locationId: oldRevision.locationId,
        workOrderId: oldRevision.workOrderId,
        revisionNumber: nextNumber,
        status: "DRAFT",
        documentKind: oldRevision.documentKind,
        changeOrderNumber: oldRevision.changeOrderNumber,
        summaryNote: oldRevision.summaryNote,
        currency: oldRevision.currency,
        taxInclusive: oldRevision.taxInclusive,
        subtotalMinor: 0n,
        discountMinor: 0n,
        taxMinor: 0n,
        totalMinor: 0n,
        supersedesRevisionId: oldRevision.id,
        createdByUserId: input.context.actorId,
      },
    });

    return { newRevisionId: newRevision.id, newRevisionNumber: nextNumber };
  });
}

// --- Helpers ---

async function loadRevisionForMutation(
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
      status: true,
      documentKind: true,
      changeOrderNumber: true,
      summaryNote: true,
      currency: true,
      taxInclusive: true,
    },
  });
  if (!revision) throw new EstimateFailed("revision_not_found");
  return revision;
}

export async function computeTotals(
  transaction: TransactionalClient,
  revisionId: string,
): Promise<{ subtotalMinor: number; discountMinor: number; taxMinor: number; totalMinor: number }> {
  const lines = await transaction.estimateLine.findMany({
    where: { estimateRevisionId: revisionId },
    select: { grossMinor: true, discountMinor: true, taxMinor: true, totalMinor: true },
  });

  let subtotalMinor = 0n;
  let discountMinor = 0n;
  let taxMinor = 0n;
  let totalMinor = 0n;

  for (const line of lines) {
    subtotalMinor += line.grossMinor;
    discountMinor += line.discountMinor;
    taxMinor += line.taxMinor;
    totalMinor += line.totalMinor;
  }

  return {
    subtotalMinor: Number(subtotalMinor),
    discountMinor: Number(discountMinor),
    taxMinor: Number(taxMinor),
    totalMinor: Number(totalMinor),
  };
}

async function nextRevisionLinePosition(
  transaction: TransactionalClient,
  revisionId: string,
): Promise<number> {
  const latest = await transaction.estimateLine.findFirst({
    where: { estimateRevisionId: revisionId },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  return (latest?.position ?? 0) + 1;
}

async function recomputeTotals(
  transaction: TransactionalClient,
  revisionId: string,
): Promise<void> {
  const totals = await computeTotals(transaction, revisionId);
  await transaction.estimateRevision.update({
    where: { id: revisionId },
    data: {
      subtotalMinor: BigInt(totals.subtotalMinor),
      discountMinor: BigInt(totals.discountMinor),
      taxMinor: BigInt(totals.taxMinor),
      totalMinor: BigInt(totals.totalMinor),
    },
  });
}

void currencyCode;
