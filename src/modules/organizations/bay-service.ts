import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import { assertTenantAccess, type TenantContext } from "@/modules/tenancy/policy";

export type BayServiceInput = Readonly<{ db: PrismaClient; context: TenantContext }>;

export class BayFailed extends Error {
  constructor(
    public readonly reason:
      "location_not_found" | "bay_not_found" | "invalid_name" | "duplicate_name",
  ) {
    super("The bay operation could not be completed.");
    this.name = "BayFailed";
  }
}

/** Lists a location's bays (active only unless includeInactive). */
export async function listBays(
  input: BayServiceInput & { locationId: string; includeInactive?: boolean },
): Promise<ReadonlyArray<Readonly<{ id: string; name: string; active: boolean }>>> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.read",
  );

  const location = await input.db.location.findFirst({
    where: { id: input.locationId, organizationId: input.context.organizationId },
    select: { id: true },
  });
  if (!location) throw new BayFailed("location_not_found");

  const bays = await input.db.locationBay.findMany({
    where: {
      organizationId: input.context.organizationId,
      locationId: location.id,
      ...(input.includeInactive ? {} : { active: true }),
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true, active: true },
  });
  return bays;
}

/** Creates a named bay ("Bay 1", "Lift 3", "Alignment") on a location. */
export async function createBay(
  input: BayServiceInput & { locationId: string; name: string },
): Promise<Readonly<{ bayId: string }>> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );

  const name = input.name.trim();
  if (name.length < 1 || name.length > 80) throw new BayFailed("invalid_name");

  return input.db.$transaction(async (transaction) => {
    const location = await transaction.location.findFirst({
      where: { id: input.locationId, organizationId: input.context.organizationId },
      select: { id: true },
    });
    if (!location) throw new BayFailed("location_not_found");

    const existing = await transaction.locationBay.findFirst({
      where: {
        organizationId: input.context.organizationId,
        locationId: location.id,
        name,
      },
      select: { id: true },
    });
    if (existing) throw new BayFailed("duplicate_name");

    const bay = await transaction.locationBay.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        locationId: location.id,
        name,
      },
    });
    return { bayId: bay.id };
  });
}

/** Deactivates a bay (historical bay labels on work orders are untouched). */
export async function deactivateBay(input: BayServiceInput & { bayId: string }): Promise<void> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );

  const update = await input.db.locationBay.updateMany({
    where: { id: input.bayId, organizationId: input.context.organizationId },
    data: { active: false },
  });
  if (update.count !== 1) throw new BayFailed("bay_not_found");
}
