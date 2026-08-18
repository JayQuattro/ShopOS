import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import { resolveMapsAdapter } from "@/modules/integrations/maps/maps-connector-service";
import { assertTenantAccess, type TenantContext } from "@/modules/tenancy/policy";
import {
  canTransitionTransport,
  isTransportTerminal,
  type TransportStatus,
} from "@/modules/transport/transport-state-machine";

export type TransportServiceInput = Readonly<{ db: PrismaClient; context: TenantContext }>;

export class TransportFailed extends Error {
  constructor(
    public readonly reason:
      | "transport_not_found"
      | "customer_not_found"
      | "location_not_found"
      | "asset_not_found"
      | "work_order_not_found"
      | "driver_not_a_member"
      | "invalid_transition"
      | "invalid_address"
      | "invalid_reason",
  ) {
    super("The transport operation could not be completed.");
    this.name = "TransportFailed";
  }
}

export type TransportJobSummary = Readonly<{
  id: string;
  kind: "PICKUP" | "DELIVERY";
  status: TransportStatus;
  customerId: string;
  customerName: string;
  contactPhone: string;
  assetId: string | null;
  assetName: string | null;
  workOrderId: string | null;
  workOrderNumber: string | null;
  addressLine1: string;
  city: string;
  stateProvince: string;
  postalCode: string;
  geocodedFormatted: string | null;
  lat: number | null;
  lng: number | null;
  scheduledAt: Date | null;
  driverUserId: string | null;
  driverName: string | null;
  fleetAssetId: string | null;
  fleetAssetName: string | null;
  etaSeconds: number | null;
  distanceMeters: number | null;
  note: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  createdAt: Date;
}>;

const SUMMARY_SELECT = {
  id: true,
  kind: true,
  status: true,
  customerId: true,
  contactPhone: true,
  assetId: true,
  workOrderId: true,
  addressLine1: true,
  city: true,
  stateProvince: true,
  postalCode: true,
  geocodedFormatted: true,
  lat: true,
  lng: true,
  scheduledAt: true,
  driverUserId: true,
  fleetAssetId: true,
  etaSeconds: true,
  distanceMeters: true,
  note: true,
  startedAt: true,
  completedAt: true,
  cancelledAt: true,
  cancelReason: true,
  createdAt: true,
  customer: { select: { displayName: true } },
  asset: { select: { displayName: true } },
  workOrder: { select: { number: true } },
  driver: { select: { displayName: true } },
  fleetAsset: { select: { displayName: true } },
} as const;

type TransportRow = {
  id: string;
  kind: "PICKUP" | "DELIVERY";
  status: TransportStatus;
  customerId: string;
  contactPhone: string;
  assetId: string | null;
  workOrderId: string | null;
  addressLine1: string;
  city: string;
  stateProvince: string;
  postalCode: string;
  geocodedFormatted: string | null;
  lat: number | null;
  lng: number | null;
  scheduledAt: Date | null;
  driverUserId: string | null;
  fleetAssetId: string | null;
  etaSeconds: number | null;
  distanceMeters: number | null;
  note: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  createdAt: Date;
  customer: { displayName: string };
  asset: { displayName: string } | null;
  workOrder: { number: string } | null;
  driver: { displayName: string } | null;
  fleetAsset: { displayName: string } | null;
};

function toSummary(row: TransportRow): TransportJobSummary {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    customerId: row.customerId,
    customerName: row.customer.displayName,
    contactPhone: row.contactPhone,
    assetId: row.assetId,
    assetName: row.asset?.displayName ?? null,
    workOrderId: row.workOrderId,
    workOrderNumber: row.workOrder?.number ?? null,
    addressLine1: row.addressLine1,
    city: row.city,
    stateProvince: row.stateProvince,
    postalCode: row.postalCode,
    geocodedFormatted: row.geocodedFormatted,
    lat: row.lat,
    lng: row.lng,
    scheduledAt: row.scheduledAt,
    driverUserId: row.driverUserId,
    driverName: row.driver?.displayName ?? null,
    fleetAssetId: row.fleetAssetId,
    fleetAssetName: row.fleetAsset?.displayName ?? null,
    etaSeconds: row.etaSeconds,
    distanceMeters: row.distanceMeters,
    note: row.note,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    cancelledAt: row.cancelledAt,
    cancelReason: row.cancelReason,
    createdAt: row.createdAt,
  };
}

function formatAddress(job: {
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  stateProvince: string;
  postalCode: string;
}): string {
  return [job.addressLine1, job.addressLine2, `${job.city}, ${job.stateProvince} ${job.postalCode}`]
    .filter(Boolean)
    .join(", ");
}

/**
 * Schedules a pickup (customer → shop) or delivery (shop → customer) run.
 * The address is geocoded through the maps connector when active; a miss
 * never blocks scheduling.
 */
export async function createTransportJob(
  input: TransportServiceInput & {
    locationId: string;
    customerId: string;
    kind: "PICKUP" | "DELIVERY";
    contactPhone: string;
    addressLine1: string;
    addressLine2?: string;
    city: string;
    stateProvince: string;
    postalCode: string;
    assetId?: string;
    workOrderId?: string;
    scheduledAt?: Date;
    note?: string;
  },
): Promise<Readonly<{ transportJobId: string }>> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId, locationId: input.locationId },
    "work_orders.write",
  );

  if (!input.addressLine1.trim() || !input.city.trim() || !input.stateProvince.trim()) {
    throw new TransportFailed("invalid_address");
  }

  return input.db.$transaction(async (transaction) => {
    const location = await transaction.location.findFirst({
      where: { id: input.locationId, organizationId: input.context.organizationId },
      select: { id: true },
    });
    if (!location) throw new TransportFailed("location_not_found");

    const customer = await transaction.customer.findFirst({
      where: { id: input.customerId, organizationId: input.context.organizationId },
      select: { id: true },
    });
    if (!customer) throw new TransportFailed("customer_not_found");

    if (input.assetId) {
      const asset = await transaction.asset.findFirst({
        where: { id: input.assetId, organizationId: input.context.organizationId },
        select: { id: true },
      });
      if (!asset) throw new TransportFailed("asset_not_found");
    }

    if (input.workOrderId) {
      const workOrder = await transaction.workOrder.findFirst({
        where: { id: input.workOrderId, organizationId: input.context.organizationId },
        select: { id: true },
      });
      if (!workOrder) throw new TransportFailed("work_order_not_found");
    }

    let geocoded: { lat: number; lng: number; formatted: string } | null = null;
    try {
      const adapter = await resolveMapsAdapter(input.db, input.context.organizationId);
      geocoded = (await adapter?.geocode(formatAddress(input))) ?? null;
    } catch {
      geocoded = null;
    }

    const created = await transaction.transportJob.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        locationId: input.locationId,
        customerId: input.customerId,
        kind: input.kind,
        contactPhone: input.contactPhone.trim(),
        addressLine1: input.addressLine1.trim(),
        ...(input.addressLine2 ? { addressLine2: input.addressLine2.trim() } : {}),
        city: input.city.trim(),
        stateProvince: input.stateProvince.trim(),
        postalCode: input.postalCode.trim(),
        ...(input.assetId ? { assetId: input.assetId } : {}),
        ...(input.workOrderId ? { workOrderId: input.workOrderId } : {}),
        ...(input.scheduledAt ? { scheduledAt: input.scheduledAt } : {}),
        ...(input.note ? { note: input.note.trim() } : {}),
        ...(geocoded
          ? { lat: geocoded.lat, lng: geocoded.lng, geocodedFormatted: geocoded.formatted }
          : {}),
      },
      select: { id: true },
    });

    return { transportJobId: created.id };
  });
}

/**
 * Sends the driver out: SCHEDULED → EN_ROUTE, snapshotting ETA and distance
 * from the organization's address to the job's geocoded address.
 */
export async function startTransportJob(
  input: TransportServiceInput & {
    transportJobId: string;
    driverUserId: string;
    fleetAssetId?: string;
  },
): Promise<void> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );

  await input.db.$transaction(async (transaction) => {
    const job = await transaction.transportJob.findFirst({
      where: { id: input.transportJobId, organizationId: input.context.organizationId },
      select: { id: true, status: true, lat: true, lng: true },
    });
    if (!job) throw new TransportFailed("transport_not_found");
    if (!canTransitionTransport(job.status, "EN_ROUTE")) {
      throw new TransportFailed("invalid_transition");
    }

    const membership = await transaction.organizationMembership.findFirst({
      where: {
        organizationId: input.context.organizationId,
        userId: input.driverUserId,
        active: true,
      },
      select: { id: true },
    });
    if (!membership) throw new TransportFailed("driver_not_a_member");

    if (input.fleetAssetId) {
      const asset = await transaction.asset.findFirst({
        where: { id: input.fleetAssetId, organizationId: input.context.organizationId },
        select: { id: true },
      });
      if (!asset) throw new TransportFailed("asset_not_found");
    }

    let eta: { etaSeconds: number; distanceMeters: number } | null = null;
    if (job.lat !== null && job.lng !== null) {
      try {
        const [org, adapter] = await Promise.all([
          transaction.organization.findUnique({
            where: { id: input.context.organizationId },
            select: {
              addressLine1: true,
              addressLine2: true,
              city: true,
              stateProvince: true,
              postalCode: true,
            },
          }),
          resolveMapsAdapter(input.db, input.context.organizationId),
        ]);
        const originQuery = org?.addressLine1
          ? formatAddress({
              addressLine1: org.addressLine1,
              addressLine2: org.addressLine2,
              city: org.city ?? "",
              stateProvince: org.stateProvince ?? "",
              postalCode: org.postalCode ?? "",
            })
          : null;
        if (adapter && originQuery) {
          const origin = await adapter.geocode(originQuery);
          if (origin) {
            const route = await adapter.route(
              { lat: origin.lat, lng: origin.lng },
              { lat: job.lat, lng: job.lng },
            );
            if (route)
              eta = { etaSeconds: route.durationSeconds, distanceMeters: route.distanceMeters };
          }
        }
      } catch {
        eta = null;
      }
    }

    await transaction.transportJob.update({
      where: { id: job.id },
      data: {
        status: "EN_ROUTE",
        driverUserId: input.driverUserId,
        ...(input.fleetAssetId ? { fleetAssetId: input.fleetAssetId } : {}),
        startedAt: new Date(),
        ...(eta ? { etaSeconds: eta.etaSeconds, distanceMeters: eta.distanceMeters } : {}),
      },
    });
  });
}

/** Marks the handover done: EN_ROUTE → COMPLETED. */
export async function completeTransportJob(
  input: TransportServiceInput & { transportJobId: string },
): Promise<void> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );

  const job = await input.db.transportJob.findFirst({
    where: { id: input.transportJobId, organizationId: input.context.organizationId },
    select: { id: true, status: true },
  });
  if (!job) throw new TransportFailed("transport_not_found");
  if (!canTransitionTransport(job.status, "COMPLETED")) {
    throw new TransportFailed("invalid_transition");
  }

  await input.db.transportJob.update({
    where: { id: job.id },
    data: { status: "COMPLETED", completedAt: new Date() },
  });
}

/** Cancels a run that hasn't completed, with a reason. */
export async function cancelTransportJob(
  input: TransportServiceInput & { transportJobId: string; reason: string },
): Promise<void> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );

  if (!input.reason.trim()) throw new TransportFailed("invalid_reason");

  const job = await input.db.transportJob.findFirst({
    where: { id: input.transportJobId, organizationId: input.context.organizationId },
    select: { id: true, status: true },
  });
  if (!job) throw new TransportFailed("transport_not_found");
  if (!canTransitionTransport(job.status, "CANCELLED")) {
    throw new TransportFailed("invalid_transition");
  }

  await input.db.transportJob.update({
    where: { id: job.id },
    data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: input.reason.trim() },
  });
}

/** The dispatch board: open runs by default, everything on request. */
export async function listTransportJobs(
  input: TransportServiceInput & {
    openOnly?: boolean;
    kind?: "PICKUP" | "DELIVERY";
    driverUserId?: string;
  },
): Promise<readonly TransportJobSummary[]> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.read",
  );

  const where: Record<string, unknown> = { organizationId: input.context.organizationId };
  if (!input.context.organizationWideLocationAccess && input.context.allowedLocationIds.size > 0) {
    where.locationId = { in: [...input.context.allowedLocationIds] };
  }
  if (input.openOnly) {
    where.status = { in: ["SCHEDULED", "EN_ROUTE"] };
  }
  if (input.kind) where.kind = input.kind;
  if (input.driverUserId) where.driverUserId = input.driverUserId;

  const jobs = await input.db.transportJob.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 100,
    select: SUMMARY_SELECT,
  });

  return jobs.map(toSummary);
}

export async function getTransportJob(
  input: TransportServiceInput & { transportJobId: string },
): Promise<TransportJobSummary | null> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.read",
  );

  const where: Record<string, unknown> = {
    id: input.transportJobId,
    organizationId: input.context.organizationId,
  };
  if (!input.context.organizationWideLocationAccess && input.context.allowedLocationIds.size > 0) {
    where.locationId = { in: [...input.context.allowedLocationIds] };
  }

  const job = await input.db.transportJob.findFirst({ where, select: SUMMARY_SELECT });
  return job ? toSummary(job) : null;
}

export function isTransportJobOpen(status: TransportStatus): boolean {
  return !isTransportTerminal(status);
}
