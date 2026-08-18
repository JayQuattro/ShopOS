import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import { resolveMapsAdapter } from "@/modules/integrations/maps/maps-connector-service";
import { assertTenantAccess, type TenantContext } from "@/modules/tenancy/policy";
import {
  canTransitionServiceCall,
  isServiceCallTerminal,
  type ServiceCallStatus,
} from "@/modules/service-calls/service-call-state-machine";
import { WorkOrderRepository } from "@/modules/work-orders/work-order-repository";

export type ServiceCallServiceInput = Readonly<{ db: PrismaClient; context: TenantContext }>;

type TransactionalClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$use" | "$extends"
>;

export class ServiceCallFailed extends Error {
  constructor(
    public readonly reason:
      | "service_call_not_found"
      | "customer_not_found"
      | "location_not_found"
      | "asset_not_found"
      | "technician_not_a_member"
      | "already_converted"
      | "terminal_state"
      | "invalid_transition"
      | "invalid_address"
      | "invalid_reason",
  ) {
    super("The service call operation could not be completed.");
    this.name = "ServiceCallFailed";
  }
}

export const SERVICE_CALL_KIND_LABELS = {
  JUMPSTART: "Jumpstart",
  TIRE_CHANGE: "Tire change",
  FUEL_DELIVERY: "Fuel delivery",
  LOCKOUT: "Lockout",
  BATTERY: "Battery",
  TOW_COORDINATION: "Tow coordination",
  MOBILE_REPAIR: "Mobile repair",
  OTHER: "Other",
} as const;

export type ServiceCallSummary = Readonly<{
  id: string;
  kind: keyof typeof SERVICE_CALL_KIND_LABELS;
  status: ServiceCallStatus;
  customerId: string;
  customerName: string;
  contactPhone: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  stateProvince: string;
  postalCode: string;
  lat: number | null;
  lng: number | null;
  geocodedFormatted: string | null;
  assignedTechnicianUserId: string | null;
  technicianName: string | null;
  fleetAssetId: string | null;
  fleetAssetName: string | null;
  note: string | null;
  etaSeconds: number | null;
  distanceMeters: number | null;
  workOrderId: string | null;
  workOrderNumber: string | null;
  locationId: string;
  dispatchedAt: Date | null;
  enRouteAt: Date | null;
  onSceneAt: Date | null;
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
  addressLine1: true,
  addressLine2: true,
  city: true,
  stateProvince: true,
  postalCode: true,
  lat: true,
  lng: true,
  geocodedFormatted: true,
  assignedTechnicianUserId: true,
  fleetAssetId: true,
  note: true,
  etaSeconds: true,
  distanceMeters: true,
  workOrderId: true,
  locationId: true,
  dispatchedAt: true,
  enRouteAt: true,
  onSceneAt: true,
  completedAt: true,
  cancelledAt: true,
  cancelReason: true,
  createdAt: true,
  customer: { select: { displayName: true } },
  assignedTechnician: { select: { displayName: true } },
  fleetAsset: { select: { displayName: true } },
  workOrder: { select: { number: true } },
} as const;

type ServiceCallRow = {
  id: string;
  kind: ServiceCallSummary["kind"];
  status: ServiceCallStatus;
  customerId: string;
  contactPhone: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  stateProvince: string;
  postalCode: string;
  lat: number | null;
  lng: number | null;
  geocodedFormatted: string | null;
  assignedTechnicianUserId: string | null;
  fleetAssetId: string | null;
  note: string | null;
  etaSeconds: number | null;
  distanceMeters: number | null;
  workOrderId: string | null;
  locationId: string;
  dispatchedAt: Date | null;
  enRouteAt: Date | null;
  onSceneAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  createdAt: Date;
  customer: { displayName: string };
  assignedTechnician: { displayName: string } | null;
  fleetAsset: { displayName: string } | null;
  workOrder: { number: string } | null;
};

function toSummary(row: ServiceCallRow): ServiceCallSummary {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    customerId: row.customerId,
    customerName: row.customer.displayName,
    contactPhone: row.contactPhone,
    addressLine1: row.addressLine1,
    addressLine2: row.addressLine2,
    city: row.city,
    stateProvince: row.stateProvince,
    postalCode: row.postalCode,
    lat: row.lat,
    lng: row.lng,
    geocodedFormatted: row.geocodedFormatted,
    assignedTechnicianUserId: row.assignedTechnicianUserId,
    technicianName: row.assignedTechnician?.displayName ?? null,
    fleetAssetId: row.fleetAssetId,
    fleetAssetName: row.fleetAsset?.displayName ?? null,
    note: row.note,
    etaSeconds: row.etaSeconds,
    distanceMeters: row.distanceMeters,
    workOrderId: row.workOrderId,
    workOrderNumber: row.workOrder?.number ?? null,
    locationId: row.locationId,
    dispatchedAt: row.dispatchedAt,
    enRouteAt: row.enRouteAt,
    onSceneAt: row.onSceneAt,
    completedAt: row.completedAt,
    cancelledAt: row.cancelledAt,
    cancelReason: row.cancelReason,
    createdAt: row.createdAt,
  };
}

function formatServiceAddress(call: {
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  stateProvince: string;
  postalCode: string;
}): string {
  return [
    call.addressLine1,
    call.addressLine2,
    `${call.city}, ${call.stateProvince} ${call.postalCode}`,
  ]
    .filter(Boolean)
    .join(", ");
}

/**
 * Creates a roadside service call. Geocoding runs through the maps connector
 * when one is active; a provider miss or outage never blocks taking the call —
 * the coordinates and formatted address simply stay empty.
 */
export async function createServiceCall(
  input: ServiceCallServiceInput & {
    locationId: string;
    customerId: string;
    kind: ServiceCallSummary["kind"];
    contactPhone: string;
    addressLine1: string;
    addressLine2?: string;
    city: string;
    stateProvince: string;
    postalCode: string;
    note?: string;
  },
): Promise<Readonly<{ serviceCallId: string }>> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId, locationId: input.locationId },
    "work_orders.write",
  );

  if (!input.addressLine1.trim() || !input.city.trim() || !input.stateProvince.trim()) {
    throw new ServiceCallFailed("invalid_address");
  }

  return input.db.$transaction(async (transaction) => {
    const location = await transaction.location.findFirst({
      where: { id: input.locationId, organizationId: input.context.organizationId },
      select: { id: true },
    });
    if (!location) throw new ServiceCallFailed("location_not_found");

    const customer = await transaction.customer.findFirst({
      where: { id: input.customerId, organizationId: input.context.organizationId },
      select: { id: true },
    });
    if (!customer) throw new ServiceCallFailed("customer_not_found");

    const addressQuery = formatServiceAddress(input);
    let geocoded: { lat: number; lng: number; formatted: string } | null = null;
    try {
      const adapter = await resolveMapsAdapter(input.db, input.context.organizationId);
      geocoded = (await adapter?.geocode(addressQuery)) ?? null;
    } catch {
      geocoded = null;
    }

    const created = await transaction.serviceCall.create({
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
        ...(input.note ? { note: input.note.trim() } : {}),
        ...(geocoded
          ? { lat: geocoded.lat, lng: geocoded.lng, geocodedFormatted: geocoded.formatted }
          : {}),
      },
      select: { id: true },
    });

    return { serviceCallId: created.id };
  });
}

/**
 * Dispatches a technician (and optionally a shop fleet vehicle) to a requested
 * call, snapshotting ETA and distance from the organization's address to the
 * geocoded service location when both ends have coordinates.
 */
export async function dispatchServiceCall(
  input: ServiceCallServiceInput & {
    serviceCallId: string;
    technicianUserId: string;
    fleetAssetId?: string;
  },
): Promise<void> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );

  await input.db.$transaction(async (transaction) => {
    const call = await transaction.serviceCall.findFirst({
      where: { id: input.serviceCallId, organizationId: input.context.organizationId },
      select: { id: true, status: true, lat: true, lng: true },
    });
    if (!call) throw new ServiceCallFailed("service_call_not_found");

    if (!canTransitionServiceCall(call.status, "DISPATCHED")) {
      throw new ServiceCallFailed("invalid_transition");
    }

    const membership = await transaction.organizationMembership.findFirst({
      where: {
        organizationId: input.context.organizationId,
        userId: input.technicianUserId,
        active: true,
      },
      select: { id: true },
    });
    if (!membership) throw new ServiceCallFailed("technician_not_a_member");

    if (input.fleetAssetId) {
      const asset = await transaction.asset.findFirst({
        where: { id: input.fleetAssetId, organizationId: input.context.organizationId },
        select: { id: true },
      });
      if (!asset) throw new ServiceCallFailed("asset_not_found");
    }

    // One-shot ETA snapshot: route from the shop (org address) to the roadside
    // location. Any provider failure leaves ETA empty, never blocks dispatch.
    let eta: { etaSeconds: number; distanceMeters: number } | null = null;
    if (call.lat !== null && call.lng !== null) {
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
          ? formatServiceAddress({
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
              { lat: call.lat, lng: call.lng },
            );
            if (route) {
              eta = { etaSeconds: route.durationSeconds, distanceMeters: route.distanceMeters };
            }
          }
        }
      } catch {
        eta = null;
      }
    }

    await transaction.serviceCall.update({
      where: { id: call.id },
      data: {
        status: "DISPATCHED",
        assignedTechnicianUserId: input.technicianUserId,
        ...(input.fleetAssetId ? { fleetAssetId: input.fleetAssetId } : {}),
        dispatchedAt: new Date(),
        ...(eta ? { etaSeconds: eta.etaSeconds, distanceMeters: eta.distanceMeters } : {}),
      },
    });

    await recordLinkedWorkOrderActivity(transaction, input.context, call.id, {
      eventType: "service_call.dispatched",
      summary: "Roadside service call dispatched.",
    });
  });
}

/** Advances DISPATCHED → EN_ROUTE → ON_SCENE → COMPLETED. */
export async function advanceServiceCallStatus(
  input: ServiceCallServiceInput & {
    serviceCallId: string;
    target: Exclude<ServiceCallStatus, "REQUESTED" | "DISPATCHED" | "CANCELLED">;
  },
): Promise<void> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );

  await input.db.$transaction(async (transaction) => {
    const call = await transaction.serviceCall.findFirst({
      where: { id: input.serviceCallId, organizationId: input.context.organizationId },
      select: { id: true, status: true },
    });
    if (!call) throw new ServiceCallFailed("service_call_not_found");

    if (!canTransitionServiceCall(call.status, input.target)) {
      throw new ServiceCallFailed("invalid_transition");
    }

    const now = new Date();
    await transaction.serviceCall.update({
      where: { id: call.id },
      data: {
        status: input.target,
        ...(input.target === "EN_ROUTE" ? { enRouteAt: now } : {}),
        ...(input.target === "ON_SCENE" ? { onSceneAt: now } : {}),
        ...(input.target === "COMPLETED" ? { completedAt: now } : {}),
      },
    });

    await recordLinkedWorkOrderActivity(transaction, input.context, call.id, {
      eventType: `service_call.${input.target.toLowerCase()}`,
      summary: `Roadside service call ${input.target === "EN_ROUTE" ? "en route" : input.target === "ON_SCENE" ? "technician on scene" : "completed"}.`,
    });
  });
}

/** Cancels a call the technician has not reached yet, with a reason. */
export async function cancelServiceCall(
  input: ServiceCallServiceInput & { serviceCallId: string; reason: string },
): Promise<void> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );

  if (!input.reason.trim()) throw new ServiceCallFailed("invalid_reason");

  await input.db.$transaction(async (transaction) => {
    const call = await transaction.serviceCall.findFirst({
      where: { id: input.serviceCallId, organizationId: input.context.organizationId },
      select: { id: true, status: true },
    });
    if (!call) throw new ServiceCallFailed("service_call_not_found");

    if (!canTransitionServiceCall(call.status, "CANCELLED")) {
      throw new ServiceCallFailed("invalid_transition");
    }

    await transaction.serviceCall.update({
      where: { id: call.id },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: input.reason.trim() },
    });

    await recordLinkedWorkOrderActivity(transaction, input.context, call.id, {
      eventType: "service_call.cancelled",
      summary: `Roadside service call cancelled: ${input.reason.trim()}`,
    });
  });
}

/**
 * Converts a service call into a shop work order, inheriting the customer and
 * the dispatching location. The concern line carries the roadside kind and note
 * so the shop floor sees the full story.
 */
export async function convertServiceCallToWorkOrder(
  input: ServiceCallServiceInput & { serviceCallId: string; assetId?: string },
): Promise<Readonly<{ workOrderId: string }>> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );

  const call = await input.db.serviceCall.findFirst({
    where: { id: input.serviceCallId, organizationId: input.context.organizationId },
    select: {
      id: true,
      customerId: true,
      locationId: true,
      kind: true,
      note: true,
      workOrderId: true,
      status: true,
    },
  });
  if (!call) throw new ServiceCallFailed("service_call_not_found");
  if (call.workOrderId) throw new ServiceCallFailed("already_converted");
  if (isServiceCallTerminal(call.status)) throw new ServiceCallFailed("terminal_state");

  const repository = new WorkOrderRepository({ db: input.db, context: input.context });
  const kindLabel = SERVICE_CALL_KIND_LABELS[call.kind];
  const workOrder = await repository.create({
    customerId: call.customerId,
    ...(input.assetId ? { assetId: input.assetId } : {}),
    locationId: call.locationId,
    customerConcern: `Roadside — ${kindLabel}${call.note ? `: ${call.note}` : ""}`,
  });

  const linked = await input.db.serviceCall.updateMany({
    where: { id: call.id, organizationId: input.context.organizationId, workOrderId: null },
    data: { workOrderId: workOrder.id },
  });
  if (linked.count !== 1) {
    throw new ServiceCallFailed("already_converted");
  }

  await input.db.activityEvent.create({
    data: {
      id: randomUUID(),
      organizationId: input.context.organizationId,
      locationId: workOrder.locationId,
      workOrderId: workOrder.id,
      actorUserId: input.context.actorId,
      eventType: "service_call.converted",
      summary: `Created from roadside service call (${kindLabel}).`,
    },
  });

  return { workOrderId: workOrder.id };
}

/** Lists service calls for the board: open calls by default, all on request. */
export async function listServiceCalls(
  input: ServiceCallServiceInput & {
    openOnly?: boolean;
    status?: ServiceCallStatus;
    technicianUserId?: string;
  },
): Promise<readonly ServiceCallSummary[]> {
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
    where.status = { in: ["REQUESTED", "DISPATCHED", "EN_ROUTE", "ON_SCENE"] };
  } else if (input.status) {
    where.status = input.status;
  }
  if (input.technicianUserId) {
    where.assignedTechnicianUserId = input.technicianUserId;
  }

  const calls = await input.db.serviceCall.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 100,
    select: SUMMARY_SELECT,
  });

  return calls.map(toSummary);
}

export async function getServiceCall(
  input: ServiceCallServiceInput & { serviceCallId: string },
): Promise<ServiceCallSummary | null> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.read",
  );

  const where: Record<string, unknown> = {
    id: input.serviceCallId,
    organizationId: input.context.organizationId,
  };
  if (!input.context.organizationWideLocationAccess && input.context.allowedLocationIds.size > 0) {
    where.locationId = { in: [...input.context.allowedLocationIds] };
  }

  const call = await input.db.serviceCall.findFirst({ where, select: SUMMARY_SELECT });
  return call ? toSummary(call) : null;
}

/**
 * Activity events require a work order; roadside-only calls keep their history
 * on the record itself (timestamps + cancel reason).
 */
async function recordLinkedWorkOrderActivity(
  transaction: TransactionalClient,
  context: TenantContext,
  serviceCallId: string,
  event: Readonly<{ eventType: string; summary: string }>,
): Promise<void> {
  const linked = await transaction.serviceCall.findFirst({
    where: { id: serviceCallId, organizationId: context.organizationId },
    select: { workOrderId: true, workOrder: { select: { locationId: true } } },
  });
  if (!linked?.workOrderId || !linked.workOrder) return;

  await transaction.activityEvent.create({
    data: {
      id: randomUUID(),
      organizationId: context.organizationId,
      locationId: linked.workOrder.locationId,
      workOrderId: linked.workOrderId,
      actorUserId: context.actorId,
      eventType: event.eventType,
      summary: event.summary,
    },
  });
}
