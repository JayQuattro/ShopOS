import { randomUUID } from "node:crypto";

import type { PrismaClient, PricedLineKind } from "@/generated/prisma/client";
import { calculateLine, currencyCode, type PricedLineInput } from "@/modules/shared/money";
import { assertTenantAccess, type TenantContext } from "@/modules/tenancy/policy";
import { transitionStatus } from "@/modules/work-orders/work-order-service";

type TransactionalClient = Omit<
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
      | "line_not_found"
      | "invalid_currency",
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
    position: number;
  },
): Promise<Readonly<{ lineId: string }>> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );

  // Compute financial fields using the pure money kernel.
  const calculated = calculateLine({
    id: "temp",
    kind: input.kind as PricedLineInput["kind"],
    quantityMilli: input.quantityMilli,
    unitPriceMinor: input.unitPriceMinor,
    discountMinor: input.discountMinor,
    taxable: input.taxable,
    taxRateBasisPoints: input.taxRateBasisPoints,
    authorization: "pending",
  });

  return input.db.$transaction(async (transaction) => {
    const revision = await loadRevisionForMutation(transaction, input.context, input.revisionId);
    if (revision.status !== "DRAFT") throw new EstimateFailed("revision_not_draft");

    const line = await transaction.estimateLine.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        estimateRevisionId: revision.id,
        serviceGroupKey: input.serviceGroupKey,
        kind: input.kind,
        description: input.description,
        quantityMilli: input.quantityMilli,
        unitPriceMinor: BigInt(input.unitPriceMinor),
        grossMinor: BigInt(calculated.grossMinor),
        discountMinor: BigInt(input.discountMinor),
        taxable: input.taxable,
        taxRateBasisPoints: input.taxRateBasisPoints,
        taxMinor: BigInt(calculated.taxMinor),
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
    await transitionStatus({
      db: input.db,
      context: input.context,
      workOrderId: revision.workOrderId,
      targetStatus: "AWAITING_AUTHORIZATION",
    });
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

    // Mark old revision as superseded.
    await transaction.estimateRevision.update({
      where: { id: oldRevision.id },
      data: { status: "SUPERSEDED" },
    });

    const nextNumber = oldRevision.revisionNumber + 1;
    const newRevision = await transaction.estimateRevision.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        locationId: oldRevision.locationId,
        workOrderId: oldRevision.workOrderId,
        revisionNumber: nextNumber,
        status: "DRAFT",
        currency: oldRevision.currency,
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
      currency: true,
    },
  });
  if (!revision) throw new EstimateFailed("revision_not_found");
  return revision;
}

async function computeTotals(
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
