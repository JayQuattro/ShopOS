import type { PrismaClient } from "@/generated/prisma/client";

type TransactionalClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$use" | "$extends"
>;

export type TaxComponent = Readonly<{
  name: string;
  rateBasisPoints: number;
  amountMinor: number;
}>;

/**
 * Resolves the components a line's tax breaks into: the chosen rate, plus
 * every other active rate sharing its stack group (Canada-style GST +
 * PST/QST). A rate without a group resolves to itself. Group rates apply
 * to the same base and round separately — the CRA-acceptable approach —
 * so the document can display each jurisdiction's share.
 */
export async function resolveTaxComponents(
  db: PrismaClient | TransactionalClient,
  organizationId: string,
  taxRateId: string,
): Promise<readonly Readonly<{ name: string; rateBasisPoints: number }>[] | null> {
  const rate = await db.taxRate.findFirst({
    where: { id: taxRateId, organizationId, active: true },
    select: { name: true, rateBasisPoints: true, stackGroup: true, sortOrder: true },
  });
  if (!rate) return null;

  if (!rate.stackGroup) {
    return [{ name: rate.name, rateBasisPoints: rate.rateBasisPoints }];
  }

  const group = await db.taxRate.findMany({
    where: { organizationId, stackGroup: rate.stackGroup, active: true },
    orderBy: { sortOrder: "asc" },
    select: { name: true, rateBasisPoints: true },
  });
  return group;
}

/**
 * Per-component tax on one base: each rate rounds on its own, then the
 * amounts sum. That sum is the line's taxMinor and the effective basis
 * points for storage.
 */
export function computeStackedTax(
  netMinor: number,
  components: readonly Readonly<{ name: string; rateBasisPoints: number }>[],
): { taxMinor: number; effectiveBasisPoints: number; breakdown: readonly TaxComponent[] } {
  let taxMinor = 0;
  let effectiveBasisPoints = 0;
  const breakdown: TaxComponent[] = [];
  for (const component of components) {
    const amount = Math.round((netMinor * component.rateBasisPoints) / 10_000);
    taxMinor += amount;
    effectiveBasisPoints += component.rateBasisPoints;
    breakdown.push({ ...component, amountMinor: amount });
  }
  return { taxMinor, effectiveBasisPoints, breakdown };
}
