import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import { assertTenantAccess, type TenantContext } from "@/modules/tenancy/policy";

export type StagingServiceInput = Readonly<{ db: PrismaClient; context: TenantContext }>;

export type VehicleStageValue =
  | "WAITING"
  | "IN_BAY"
  | "ON_LIFT"
  | "TEST_DRIVE"
  | "WAITING_PARTS"
  | "READY_FOR_PICKUP"
  | "PICKED_UP";

export class StagingFailed extends Error {
  constructor(public readonly reason: "work_order_not_found" | "invalid_bay_label") {
    super("The vehicle staging operation could not be completed.");
    this.name = "StagingFailed";
  }
}

/** Customer- and shop-facing labels for each physical stage. */
export const VEHICLE_STAGE_LABELS: Readonly<Record<VehicleStageValue, string>> = {
  WAITING: "Checked in — waiting for a bay",
  IN_BAY: "In the bay",
  ON_LIFT: "On the lift",
  TEST_DRIVE: "Out on a test drive",
  WAITING_PARTS: "Waiting on parts",
  READY_FOR_PICKUP: "Ready for pickup",
  PICKED_UP: "Picked up",
};

/**
 * Sets the vehicle's physical stage and/or bay label. Every change narrates
 * into the work-order activity feed so the shop can trace where a car was
 * and when.
 */
export async function setVehicleStage(
  input: StagingServiceInput & {
    workOrderId: string;
    stage?: VehicleStageValue | null;
    bayLabel?: string | null;
  },
): Promise<void> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );

  const bayLabel = input.bayLabel !== undefined ? (input.bayLabel ?? "").trim() : undefined;
  if (bayLabel !== undefined && bayLabel.length > 60) {
    throw new StagingFailed("invalid_bay_label");
  }

  await input.db.$transaction(async (transaction) => {
    const workOrder = await transaction.workOrder.findFirst({
      where: { id: input.workOrderId, organizationId: input.context.organizationId },
      select: {
        id: true,
        locationId: true,
        vehicleStage: true,
        bayLabel: true,
      },
    });
    if (!workOrder) throw new StagingFailed("work_order_not_found");

    const nextStage = input.stage === undefined ? workOrder.vehicleStage : input.stage;
    const nextBay = bayLabel === undefined ? workOrder.bayLabel : bayLabel || null;

    if (nextStage === workOrder.vehicleStage && nextBay === workOrder.bayLabel) return;

    await transaction.workOrder.update({
      where: { id: workOrder.id },
      data: {
        ...(nextStage !== workOrder.vehicleStage ? { vehicleStage: nextStage ?? null } : {}),
        ...(nextBay !== workOrder.bayLabel ? { bayLabel: nextBay } : {}),
      },
    });

    const parts: string[] = [];
    if (nextStage !== workOrder.vehicleStage && nextStage) {
      parts.push(VEHICLE_STAGE_LABELS[nextStage as VehicleStageValue]);
    } else if (nextStage !== workOrder.vehicleStage) {
      parts.push("Stage cleared");
    }
    if (nextBay !== workOrder.bayLabel) {
      parts.push(nextBay ? `Spot: ${nextBay}` : "Spot cleared");
    }

    await transaction.activityEvent.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        locationId: workOrder.locationId,
        workOrderId: workOrder.id,
        actorUserId: input.context.actorId,
        eventType: "vehicle.stage_changed",
        summary: parts.join(" · ") || "Vehicle staging updated.",
        data: {
          from: workOrder.vehicleStage,
          to: nextStage,
          bayLabel: nextBay,
        },
      },
    });
  });
}
