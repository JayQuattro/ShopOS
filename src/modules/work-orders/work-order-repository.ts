import { randomUUID } from "node:crypto";

import type { PrismaClient, WorkType } from "@/generated/prisma/client";
import { assertTenantAccess, type TenantContext } from "@/modules/tenancy/policy";

export type WorkOrderSummary = Readonly<{
  id: string;
  number: string;
  workType: WorkType;
  status: string;
  customerConcern: string;
  customerId: string;
  assetId: string;
  locationId: string;
  promisedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
}>;

export type WorkOrderDetail = WorkOrderSummary &
  Readonly<{
    activity: readonly Readonly<{
      id: string;
      eventType: string;
      summary: string;
      occurredAt: Date;
    }>[];
  }>;

export type CreateWorkOrderInput = Readonly<{
  customerId: string;
  assetId: string;
  locationId: string;
  workType?: WorkType;
  customerConcern: string;
  promisedAt?: Date;
}>;

export type ListWorkOrdersInput = Readonly<{
  status?: string;
  customerId?: string;
  assetId?: string;
  search?: string;
}>;

export class WorkOrderRepository {
  constructor(private readonly deps: Readonly<{ db: PrismaClient; context: TenantContext }>) {}

  private scopeLocation(where: Record<string, unknown>): Record<string, unknown> {
    const ctx = this.deps.context;
    if (!ctx.organizationWideLocationAccess && ctx.allowedLocationIds.size > 0) {
      return { ...where, locationId: { in: [...ctx.allowedLocationIds] } };
    }
    return where;
  }

  async findById(id: string): Promise<WorkOrderDetail | null> {
    assertTenantAccess(
      this.deps.context,
      { organizationId: this.deps.context.organizationId },
      "work_orders.read",
    );

    const wo = await this.deps.db.workOrder.findFirst({
      where: this.scopeLocation({
        id,
        organizationId: this.deps.context.organizationId,
      }),
      include: {
        activityEvents: {
          orderBy: { occurredAt: "desc" },
          take: 50,
          select: { id: true, eventType: true, summary: true, occurredAt: true },
        },
      },
    });

    if (!wo) return null;

    return {
      id: wo.id,
      number: wo.number,
      workType: wo.workType,
      status: wo.status,
      customerConcern: wo.customerConcern,
      customerId: wo.customerId,
      assetId: wo.assetId,
      locationId: wo.locationId,
      promisedAt: wo.promisedAt,
      completedAt: wo.completedAt,
      createdAt: wo.createdAt,
      activity: wo.activityEvents.map((e) => ({
        id: e.id,
        eventType: e.eventType,
        summary: e.summary,
        occurredAt: e.occurredAt,
      })),
    };
  }

  async list(input: ListWorkOrdersInput = {}): Promise<readonly WorkOrderSummary[]> {
    assertTenantAccess(
      this.deps.context,
      { organizationId: this.deps.context.organizationId },
      "work_orders.read",
    );

    const where = this.scopeLocation({
      organizationId: this.deps.context.organizationId,
      ...(input.status ? { status: input.status } : {}),
      ...(input.customerId ? { customerId: input.customerId } : {}),
      ...(input.assetId ? { assetId: input.assetId } : {}),
      ...(input.search
        ? {
            OR: [
              { number: { contains: input.search, mode: "insensitive" as const } },
              { customerConcern: { contains: input.search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    });

    const workOrders = await this.deps.db.workOrder.findMany({
      where,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        number: true,
        workType: true,
        status: true,
        customerConcern: true,
        customerId: true,
        assetId: true,
        locationId: true,
        promisedAt: true,
        completedAt: true,
        createdAt: true,
      },
    });

    return workOrders;
  }

  async create(input: CreateWorkOrderInput): Promise<WorkOrderSummary> {
    assertTenantAccess(
      this.deps.context,
      { organizationId: this.deps.context.organizationId, locationId: input.locationId },
      "work_orders.write",
    );

    const ctx = this.deps.context;

    // Verify customer, asset, and location all exist in the same org.
    const [customer, asset, location] = await Promise.all([
      this.deps.db.customer.findFirst({
        where: { id: input.customerId, organizationId: ctx.organizationId },
        select: { id: true },
      }),
      this.deps.db.asset.findFirst({
        where: { id: input.assetId, organizationId: ctx.organizationId },
        select: { id: true },
      }),
      this.deps.db.location.findFirst({
        where: { id: input.locationId, organizationId: ctx.organizationId },
        select: { id: true },
      }),
    ]);

    if (!customer) throw new WorkOrderCreateFailed("customer_not_found");
    if (!asset) throw new WorkOrderCreateFailed("asset_not_found");
    if (!location) throw new WorkOrderCreateFailed("location_not_found");

    // Generate a sequential work-order number.
    const number = await generateWorkOrderNumber(this.deps.db, ctx.organizationId);

    const wo = await this.deps.db.workOrder.create({
      data: {
        organizationId: ctx.organizationId,
        locationId: input.locationId,
        customerId: input.customerId,
        assetId: input.assetId,
        number,
        workType: input.workType ?? "REPAIR",
        customerConcern: input.customerConcern,
        ...(input.promisedAt ? { promisedAt: input.promisedAt } : {}),
      },
      select: {
        id: true,
        number: true,
        workType: true,
        status: true,
        customerConcern: true,
        customerId: true,
        assetId: true,
        locationId: true,
        promisedAt: true,
        completedAt: true,
        createdAt: true,
      },
    });

    // Record initial activity.
    await this.deps.db.activityEvent.create({
      data: {
        id: randomUUID(),
        organizationId: ctx.organizationId,
        locationId: input.locationId,
        workOrderId: wo.id,
        actorUserId: ctx.actorId,
        eventType: "work_order.created",
        summary: `Work order ${number} created.`,
      },
    });

    return wo;
  }

  async update(
    id: string,
    fields: Readonly<{ customerConcern?: string; promisedAt?: Date | null }>,
  ): Promise<void> {
    assertTenantAccess(
      this.deps.context,
      { organizationId: this.deps.context.organizationId },
      "work_orders.write",
    );

    const data: Record<string, unknown> = {};
    if (fields.customerConcern !== undefined) data.customerConcern = fields.customerConcern;
    if (fields.promisedAt !== undefined) data.promisedAt = fields.promisedAt;

    if (Object.keys(data).length === 0) return;

    const update = await this.deps.db.workOrder.updateMany({
      where: this.scopeLocation({ id, organizationId: this.deps.context.organizationId }),
      data,
    });
    if (update.count !== 1) throw new WorkOrderNotFound();
  }
}

export class WorkOrderCreateFailed extends Error {
  constructor(
    public readonly reason: "customer_not_found" | "asset_not_found" | "location_not_found",
  ) {
    super("The work order could not be created.");
    this.name = "WorkOrderCreateFailed";
  }
}

export class WorkOrderNotFound extends Error {
  constructor() {
    super("Work order not found in the authorized tenant scope.");
    this.name = "WorkOrderNotFound";
  }
}

/**
 * Generates a sequential work-order number like "RO-1045" by finding the
 * highest existing number for the org and incrementing.
 */
async function generateWorkOrderNumber(db: PrismaClient, organizationId: string): Promise<string> {
  const latest = await db.workOrder.findFirst({
    where: { organizationId },
    orderBy: { number: "desc" },
    select: { number: true },
  });

  if (!latest) return "RO-1001";

  const match = latest.number.match(/(\d+)$/);
  const nextNum = match ? parseInt(match[1]!, 10) + 1 : 1001;
  return `RO-${nextNum}`;
}
