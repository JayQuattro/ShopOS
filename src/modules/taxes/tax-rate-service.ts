import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import { assertTenantAccess, type TenantContext } from "@/modules/tenancy/policy";

export type TaxServiceInput = Readonly<{ db: PrismaClient; context: TenantContext }>;

export class TaxRateFailed extends Error {
  constructor(
    public readonly reason:
      "invalid_name" | "invalid_rate" | "duplicate_name" | "tax_rate_not_found",
  ) {
    super("The tax rate operation could not be completed.");
    this.name = "TaxRateFailed";
  }
}

export type TaxRateSummary = Readonly<{
  id: string;
  name: string;
  rateBasisPoints: number;
  active: boolean;
}>;

/** Lists the org's tax rates (active only unless includeInactive). */
export async function listTaxRates(
  input: TaxServiceInput & { includeInactive?: boolean },
): Promise<readonly TaxRateSummary[]> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.read",
  );

  const rates = await input.db.taxRate.findMany({
    where: {
      organizationId: input.context.organizationId,
      ...(input.includeInactive ? {} : { active: true }),
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, rateBasisPoints: true, active: true },
  });
  return rates;
}

/** Creates a named tax rate (basis points, 0–10000). */
export async function createTaxRate(
  input: TaxServiceInput & { name: string; rateBasisPoints: number; stackGroup?: string },
): Promise<Readonly<{ taxRateId: string }>> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "organizations.manage",
  );

  const name = input.name.trim();
  if (name.length < 1 || name.length > 120) throw new TaxRateFailed("invalid_name");
  if (
    !Number.isSafeInteger(input.rateBasisPoints) ||
    input.rateBasisPoints < 0 ||
    input.rateBasisPoints > 10000
  ) {
    throw new TaxRateFailed("invalid_rate");
  }

  const existing = await input.db.taxRate.findFirst({
    where: { organizationId: input.context.organizationId, name },
    select: { id: true },
  });
  if (existing) throw new TaxRateFailed("duplicate_name");

  const stackGroup = input.stackGroup?.trim() ?? "";
  const rate = await input.db.taxRate.create({
    data: {
      id: randomUUID(),
      organizationId: input.context.organizationId,
      ...(stackGroup ? { stackGroup } : {}),
      name,
      rateBasisPoints: input.rateBasisPoints,
    },
  });
  return { taxRateId: rate.id };
}

/** Deactivates a rate — lines store resolved bps, so history is untouched. */
export async function deactivateTaxRate(
  input: TaxServiceInput & { taxRateId: string },
): Promise<void> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "organizations.manage",
  );

  const update = await input.db.taxRate.updateMany({
    where: { id: input.taxRateId, organizationId: input.context.organizationId },
    data: { active: false },
  });
  if (update.count !== 1) throw new TaxRateFailed("tax_rate_not_found");
}
