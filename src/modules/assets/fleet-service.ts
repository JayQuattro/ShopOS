import type { PrismaClient } from "@/generated/prisma/client";
import { assertTenantAccess, type TenantContext } from "@/modules/tenancy/policy";

export type FleetServiceInput = Readonly<{ db: PrismaClient; context: TenantContext }>;

export class FleetFailed extends Error {
  constructor(public readonly reason: "asset_not_found") {
    super("The fleet operation could not be completed.");
    this.name = "FleetFailed";
  }
}

export type FleetVehicle = Readonly<{
  id: string;
  displayName: string;
  licensePlate: string | null;
  plateJurisdiction: string | null;
  mileage: number | null;
  status: string;
  loanerStatus: Readonly<{ out: boolean; workOrderNumber: string | null; since: Date | null }>;
  openServiceCalls: ReadonlyArray<{ id: string; kind: string; status: string }>;
}>;

/**
 * Marks or unmarks an asset as a shop fleet vehicle — the explicit signal the
 * loaner picker and roadside dispatch prefer over naming conventions.
 */
export async function setFleetVehicle(
  input: FleetServiceInput & { assetId: string; isFleetVehicle: boolean },
): Promise<void> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "assets.write",
  );

  const updated = await input.db.asset.updateMany({
    where: { id: input.assetId, organizationId: input.context.organizationId },
    data: { isFleetVehicle: input.isFleetVehicle },
  });
  if (updated.count !== 1) throw new FleetFailed("asset_not_found");
}

/**
 * The fleet board: fleet vehicles with plate and mileage, live loaner state,
 * and any roadside calls they're currently assigned to.
 */
export async function listFleetVehicles(
  input: FleetServiceInput,
): Promise<readonly FleetVehicle[]> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "assets.read",
  );

  const vehicles = await input.db.asset.findMany({
    where: {
      organizationId: input.context.organizationId,
      isFleetVehicle: true,
    },
    orderBy: { displayName: "asc" },
    select: {
      id: true,
      displayName: true,
      status: true,
      automotiveProfile: {
        select: { licensePlate: true, plateJurisdiction: true, lastKnownMileage: true },
      },
      loanerCheckouts: {
        where: { checkedInAt: null },
        take: 1,
        orderBy: { checkedOutAt: "desc" },
        select: { checkedOutAt: true, workOrder: { select: { number: true } } },
      },
      serviceCalls: {
        where: { status: { in: ["DISPATCHED", "EN_ROUTE", "ON_SCENE"] } },
        select: { id: true, kind: true, status: true },
      },
    },
  });

  return vehicles.map((vehicle) => {
    const openLoaner = vehicle.loanerCheckouts[0];
    return {
      id: vehicle.id,
      displayName: vehicle.displayName,
      licensePlate: vehicle.automotiveProfile?.licensePlate ?? null,
      plateJurisdiction: vehicle.automotiveProfile?.plateJurisdiction ?? null,
      mileage: vehicle.automotiveProfile?.lastKnownMileage ?? null,
      status: vehicle.status,
      loanerStatus: {
        out: openLoaner !== undefined,
        workOrderNumber: openLoaner?.workOrder.number ?? null,
        since: openLoaner?.checkedOutAt ?? null,
      },
      openServiceCalls: vehicle.serviceCalls,
    };
  });
}

/**
 * Non-fleet assets eligible to join the fleet — the picker on the fleet page.
 */
export async function listFleetCandidates(
  input: FleetServiceInput,
): Promise<readonly Readonly<{ id: string; displayName: string }>[]> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "assets.read",
  );

  return input.db.asset.findMany({
    where: {
      organizationId: input.context.organizationId,
      isFleetVehicle: false,
      status: "ACTIVE",
    },
    orderBy: { displayName: "asc" },
    take: 200,
    select: { id: true, displayName: true },
  });
}

/**
 * Loaner candidates for a work order: fleet vehicles first; when the shop has
 * none marked, the heuristic fallback (active assets not tied to this WO's
 * customer).
 */
export async function listLoanerCandidates(
  input: FleetServiceInput & { excludeCustomerId?: string },
): Promise<readonly Readonly<{ id: string; displayName: string }>[]> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.read",
  );

  const fleet = await input.db.asset.findMany({
    where: {
      organizationId: input.context.organizationId,
      status: "ACTIVE",
      isFleetVehicle: true,
    },
    select: { id: true, displayName: true },
    take: 50,
    orderBy: { displayName: "asc" },
  });
  if (fleet.length > 0) return fleet;

  return input.db.asset.findMany({
    where: {
      organizationId: input.context.organizationId,
      status: "ACTIVE",
      ...(input.excludeCustomerId ? { customerId: { not: input.excludeCustomerId } } : {}),
    },
    select: { id: true, displayName: true },
    take: 50,
    orderBy: { displayName: "asc" },
  });
}
