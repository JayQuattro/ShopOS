import { randomUUID } from "node:crypto";

import type { PrismaClient, ShopFee, ShopFeeAppliesTo } from "@/generated/prisma/client";
import type { TransactionalClient } from "@/modules/estimates/estimate-service";
import { assertTenantAccess, type TenantContext } from "@/modules/tenancy/policy";

export type ShopFeeServiceInput = Readonly<{ db: PrismaClient; context: TenantContext }>;

export class ShopFeeFailed extends Error {
  constructor(
    public readonly reason: "invalid_name" | "invalid_amount" | "duplicate_name" | "fee_not_found",
  ) {
    super("The shop fee operation could not be completed.");
    this.name = "ShopFeeFailed";
  }
}

export type ShopFeeSummary = Readonly<{
  id: string;
  name: string;
  calculation: "FLAT" | "PERCENT_OF_LABOR";
  amountMinor: string;
  rateBasisPoints: number;
  maxAmountMinor: string | null;
  taxable: boolean;
  taxRateBasisPoints: number;
  appliesTo: ShopFeeAppliesTo;
  active: boolean;
}>;

/** Lists the org's fees (active only unless includeInactive). */
export async function listShopFees(
  db: PrismaClient,
  context: TenantContext,
  options?: Readonly<{ includeInactive?: boolean }>,
): Promise<readonly ShopFeeSummary[]> {
  assertTenantAccess(context, { organizationId: context.organizationId }, "work_orders.read");

  const fees = await db.shopFee.findMany({
    where: {
      organizationId: context.organizationId,
      ...(options?.includeInactive ? {} : { active: true }),
    },
    orderBy: { name: "asc" },
  });
  return fees.map(summarize);
}

function summarize(fee: ShopFee): ShopFeeSummary {
  return {
    id: fee.id,
    name: fee.name,
    calculation: fee.calculation,
    amountMinor: fee.amountMinor.toString(),
    rateBasisPoints: fee.rateBasisPoints,
    maxAmountMinor: fee.maxAmountMinor !== null ? fee.maxAmountMinor.toString() : null,
    taxable: fee.taxable,
    taxRateBasisPoints: fee.taxRateBasisPoints,
    appliesTo: fee.appliesTo,
    active: fee.active,
  };
}

/** Creates a shop fee: flat amount or percent-of-labor with an optional cap. */
export async function createShopFee(
  db: PrismaClient,
  context: TenantContext,
  input: Readonly<{
    name: string;
    calculation: "FLAT" | "PERCENT_OF_LABOR";
    amountMinor: number;
    rateBasisPoints: number;
    maxAmountMinor?: number;
    taxable: boolean;
    taxRateBasisPoints: number;
    appliesTo: ShopFeeAppliesTo;
  }>,
): Promise<Readonly<{ feeId: string }>> {
  assertTenantAccess(context, { organizationId: context.organizationId }, "organizations.manage");

  const name = input.name.trim();
  if (name.length < 1 || name.length > 120) throw new ShopFeeFailed("invalid_name");
  const flat = input.calculation === "FLAT" ? input.amountMinor : 0;
  const percent = input.calculation === "PERCENT_OF_LABOR" ? input.rateBasisPoints : 0;
  if (
    !Number.isSafeInteger(flat) ||
    flat < 0 ||
    !Number.isSafeInteger(percent) ||
    percent < 0 ||
    percent > 10000 ||
    (input.maxAmountMinor !== undefined &&
      (!Number.isSafeInteger(input.maxAmountMinor) || input.maxAmountMinor < 0)) ||
    input.taxRateBasisPoints < 0 ||
    input.taxRateBasisPoints > 10000
  ) {
    throw new ShopFeeFailed("invalid_amount");
  }

  const existing = await db.shopFee.findFirst({
    where: { organizationId: context.organizationId, name },
    select: { id: true },
  });
  if (existing) throw new ShopFeeFailed("duplicate_name");

  const fee = await db.shopFee.create({
    data: {
      id: randomUUID(),
      organizationId: context.organizationId,
      name,
      calculation: input.calculation,
      amountMinor: BigInt(flat),
      rateBasisPoints: percent,
      ...(input.maxAmountMinor !== undefined
        ? { maxAmountMinor: BigInt(input.maxAmountMinor) }
        : {}),
      taxable: input.taxable,
      taxRateBasisPoints: input.taxable ? input.taxRateBasisPoints : 0,
      appliesTo: input.appliesTo,
    },
  });
  return { feeId: fee.id };
}

/** Deactivates a fee; presented documents keep their snapshotted fee lines. */
export async function deactivateShopFee(
  db: PrismaClient,
  context: TenantContext,
  feeId: string,
): Promise<void> {
  assertTenantAccess(context, { organizationId: context.organizationId }, "organizations.manage");

  const update = await db.shopFee.updateMany({
    where: { id: feeId, organizationId: context.organizationId },
    data: { active: false },
  });
  if (update.count !== 1) throw new ShopFeeFailed("fee_not_found");
}

/**
 * Resolves a fee's line amount for a revision: flat fees are their amount;
 * percent fees apply to the revision's labor gross, capped when a max is set.
 */
export function resolveFeeAmountMinor(
  fee: Pick<ShopFee, "calculation" | "amountMinor" | "rateBasisPoints" | "maxAmountMinor">,
  laborGrossMinor: bigint,
): number {
  let amount: bigint;
  if (fee.calculation === "FLAT") {
    amount = fee.amountMinor;
  } else {
    amount = (laborGrossMinor * BigInt(fee.rateBasisPoints)) / 10000n;
    if (fee.maxAmountMinor !== null && amount > fee.maxAmountMinor) {
      amount = fee.maxAmountMinor;
    }
  }
  return Number(amount);
}

/**
 * The fee lines to append for a given document kind, with amounts resolved
 * against the revision's current labor gross. Called at presentation; the
 * caller appends them via the normal addLine path so pricing, tax, and
 * immutability behave like any hand-entered line.
 */
export async function feeLinesForPresentation(
  transaction: TransactionalClient,
  input: Readonly<{
    organizationId: string;
    workOrderId: string;
    revisionId: string;
    documentKind: "BASELINE" | "CHANGE_ORDER";
    nextPosition: number;
  }>,
): Promise<
  ReadonlyArray<
    Readonly<{
      name: string;
      unitPriceMinor: number;
      taxable: boolean;
      taxRateBasisPoints: number;
      position: number;
      existing: boolean;
    }>
  >
> {
  const fees = await transaction.shopFee.findMany({
    where: { organizationId: input.organizationId, active: true },
    orderBy: { name: "asc" },
  });
  if (fees.length === 0) return [];

  const applies = (fee: ShopFee) =>
    fee.appliesTo === "BOTH" ||
    (input.documentKind === "BASELINE" && fee.appliesTo === "BASELINE") ||
    (input.documentKind === "CHANGE_ORDER" && fee.appliesTo === "CHANGE_ORDER");

  const laborLines = await transaction.estimateLine.findMany({
    where: {
      estimateRevisionId: input.revisionId,
      kind: "LABOR",
    },
    select: { grossMinor: true },
  });
  const laborGrossMinor = laborLines.reduce((sum, line) => sum + line.grossMinor, 0n);

  // Idempotency: skip fees already present on this revision by name.
  const existingLines = await transaction.estimateLine.findMany({
    where: { estimateRevisionId: input.revisionId, serviceGroupKey: "shop-fee" },
    select: { description: true },
  });
  const existingNames = new Set(existingLines.map((line) => line.description));

  const resolved: Array<{
    name: string;
    unitPriceMinor: number;
    taxable: boolean;
    taxRateBasisPoints: number;
    position: number;
    existing: boolean;
  }> = [];
  let position = input.nextPosition;
  for (const fee of fees) {
    if (!applies(fee)) continue;
    if (existingNames.has(fee.name)) {
      resolved.push({
        name: fee.name,
        unitPriceMinor: 0,
        taxable: false,
        taxRateBasisPoints: 0,
        position: -1,
        existing: true,
      });
      continue;
    }
    resolved.push({
      name: fee.name,
      unitPriceMinor: resolveFeeAmountMinor(fee, laborGrossMinor),
      taxable: fee.taxable,
      taxRateBasisPoints: fee.taxRateBasisPoints,
      position,
      existing: false,
    });
    position += 1;
  }
  return resolved;
}
