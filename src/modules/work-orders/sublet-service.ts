import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import { assertTenantAccess, type TenantContext } from "@/modules/tenancy/policy";

export type SubletServiceInput = Readonly<{ db: PrismaClient; context: TenantContext }>;

export class SubletFailed extends Error {
  constructor(
    public readonly reason:
      | "work_order_not_found"
      | "sublet_not_found"
      | "invalid_vendor"
      | "invalid_description"
      | "invalid_amount"
      | "invalid_transition"
      | "already_returned",
  ) {
    super("The sublet operation could not be completed.");
    this.name = "SubletFailed";
  }
}

export type SubletWorkSummary = Readonly<{
  id: string;
  workOrderId: string;
  vendorName: string;
  description: string;
  status: "sent" | "returned" | "cancelled";
  quotedMinor: string | null;
  actualMinor: string | null;
  sentAt: Date;
  returnedAt: Date | null;
  note: string | null;
}>;

function validateAmount(amount: number | undefined): void {
  if (amount !== undefined && (!Number.isSafeInteger(amount) || amount < 0)) {
    throw new SubletFailed("invalid_amount");
  }
}

/** Records work sent to an outside vendor (machine shop, glass, calibration). */
export async function sendSubletWork(
  input: SubletServiceInput & {
    workOrderId: string;
    vendorName: string;
    description: string;
    quotedMinor?: number;
    note?: string;
  },
): Promise<Readonly<{ subletId: string }>> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );

  const vendorName = input.vendorName.trim();
  if (vendorName.length < 2 || vendorName.length > 180) throw new SubletFailed("invalid_vendor");
  const description = input.description.trim();
  if (description.length < 3) throw new SubletFailed("invalid_description");
  validateAmount(input.quotedMinor);

  return input.db.$transaction(async (transaction) => {
    const workOrder = await transaction.workOrder.findFirst({
      where: { id: input.workOrderId, organizationId: input.context.organizationId },
      select: { id: true, locationId: true },
    });
    if (!workOrder) throw new SubletFailed("work_order_not_found");

    const sublet = await transaction.subletWork.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        locationId: workOrder.locationId,
        workOrderId: workOrder.id,
        vendorName,
        description,
        status: "sent",
        ...(input.quotedMinor !== undefined ? { quotedMinor: BigInt(input.quotedMinor) } : {}),
        ...(input.note ? { note: input.note.trim() } : {}),
      },
    });

    await transaction.activityEvent.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        locationId: workOrder.locationId,
        workOrderId: workOrder.id,
        actorUserId: input.context.actorId,
        eventType: "sublet.sent",
        summary: `Sublet work sent to ${vendorName}: ${description}.`,
      },
    });

    return { subletId: sublet.id };
  });
}

/** Marks sublet work returned with the actual cost. */
export async function returnSubletWork(
  input: SubletServiceInput & { subletId: string; actualMinor?: number },
): Promise<void> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );
  validateAmount(input.actualMinor);

  await input.db.$transaction(async (transaction) => {
    const sublet = await transaction.subletWork.findFirst({
      where: { id: input.subletId, organizationId: input.context.organizationId },
      select: { id: true, status: true, vendorName: true, workOrderId: true, locationId: true },
    });
    if (!sublet) throw new SubletFailed("sublet_not_found");
    if (sublet.status === "returned") throw new SubletFailed("already_returned");
    if (sublet.status === "cancelled") throw new SubletFailed("invalid_transition");

    await transaction.subletWork.update({
      where: { id: sublet.id },
      data: {
        status: "returned",
        returnedAt: new Date(),
        ...(input.actualMinor !== undefined ? { actualMinor: BigInt(input.actualMinor) } : {}),
      },
    });

    await transaction.activityEvent.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        locationId: sublet.locationId,
        workOrderId: sublet.workOrderId,
        actorUserId: input.context.actorId,
        eventType: "sublet.returned",
        summary: `Sublet work returned from ${sublet.vendorName}.`,
      },
    });
  });
}

/** Cancels sublet work that was never performed. */
export async function cancelSubletWork(
  input: SubletServiceInput & { subletId: string },
): Promise<void> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );

  const update = await input.db.subletWork.updateMany({
    where: {
      id: input.subletId,
      organizationId: input.context.organizationId,
      status: "sent",
    },
    data: { status: "cancelled" },
  });
  if (update.count !== 1) throw new SubletFailed("invalid_transition");
}

/** Lists a work order's sublet work. */
export async function listSubletsForWorkOrder(
  input: SubletServiceInput & { workOrderId: string },
): Promise<readonly SubletWorkSummary[]> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.read",
  );

  const sublets = await input.db.subletWork.findMany({
    where: { organizationId: input.context.organizationId, workOrderId: input.workOrderId },
    orderBy: { sentAt: "desc" },
    select: {
      id: true,
      workOrderId: true,
      vendorName: true,
      description: true,
      status: true,
      quotedMinor: true,
      actualMinor: true,
      sentAt: true,
      returnedAt: true,
      note: true,
    },
  });

  return sublets.map((sublet) => ({
    id: sublet.id,
    workOrderId: sublet.workOrderId,
    vendorName: sublet.vendorName,
    description: sublet.description,
    status: sublet.status as SubletWorkSummary["status"],
    quotedMinor: sublet.quotedMinor !== null ? sublet.quotedMinor.toString() : null,
    actualMinor: sublet.actualMinor !== null ? sublet.actualMinor.toString() : null,
    sentAt: sublet.sentAt,
    returnedAt: sublet.returnedAt,
    note: sublet.note,
  }));
}
