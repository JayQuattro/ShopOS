import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import { assertTenantAccess, type TenantContext } from "@/modules/tenancy/policy";

export type InspectionServiceInput = Readonly<{ db: PrismaClient; context: TenantContext }>;

type TransactionalClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$use" | "$extends"
>;

export class InspectionFailed extends Error {
  constructor(
    public readonly reason:
      | "work_order_not_found"
      | "template_not_found"
      | "inspection_not_found"
      | "item_not_found"
      | "not_draft"
      | "already_shared"
      | "invalid_condition",
  ) {
    super("The inspection operation could not be completed.");
    this.name = "InspectionFailed";
  }
}

export type InspectionItemCondition = "OK" | "WATCH" | "REPLACE" | "NA";

const CONDITIONS: ReadonlySet<string> = new Set(["OK", "WATCH", "REPLACE", "NA"]);

/**
 * Starts an inspection on a work order — blank or from a checklist
 * template (front brakes, fluids, lights…) whose items are copied in as
 * positioned rows. Draft until completed; history is immutable after.
 */
export async function createInspection(
  input: InspectionServiceInput & {
    workOrderId: string;
    title: string;
    templateId?: string;
  },
): Promise<Readonly<{ inspectionId: string }>> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );

  const title = input.title.trim();
  if (title.length < 2 || title.length > 180) throw new InspectionFailed("template_not_found");

  return input.db.$transaction(async (transaction) => {
    const workOrder = await transaction.workOrder.findFirst({
      where: { id: input.workOrderId, organizationId: input.context.organizationId },
      select: { id: true, locationId: true },
    });
    if (!workOrder) throw new InspectionFailed("work_order_not_found");

    let templateItems: ReadonlyArray<{ zone: string | null; component: string }> = [];
    if (input.templateId) {
      const template = await transaction.inspectionTemplate.findFirst({
        where: { id: input.templateId, organizationId: input.context.organizationId },
        select: {
          items: { orderBy: { position: "asc" }, select: { zone: true, component: true } },
        },
      });
      if (!template) throw new InspectionFailed("template_not_found");
      templateItems = template.items;
    }

    const inspection = await transaction.inspection.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        locationId: workOrder.locationId,
        workOrderId: workOrder.id,
        ...(input.templateId ? { inspectionTemplateId: input.templateId } : {}),
        title,
        performedByUserId: input.context.actorId,
        items: {
          create: templateItems.map((item, index) => ({
            id: randomUUID(),
            position: index + 1,
            zone: item.zone,
            component: item.component,
          })),
        },
      },
      select: { id: true },
    });
    return { inspectionId: inspection.id };
  });
}

/** Adds a checklist row to a draft inspection. */
export async function addInspectionItem(
  input: InspectionServiceInput & {
    inspectionId: string;
    zone?: string;
    component: string;
  },
): Promise<Readonly<{ itemId: string }>> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );

  return input.db.$transaction(async (transaction) => {
    const inspection = await loadDraft(transaction, input.context, input.inspectionId);
    const count = await transaction.inspectionItem.count({
      where: { organizationId: input.context.organizationId, inspectionId: inspection.id },
    });
    const item = await transaction.inspectionItem.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        inspectionId: inspection.id,
        position: count + 1,
        ...(input.zone?.trim() ? { zone: input.zone.trim() } : {}),
        component: input.component.trim(),
      },
      select: { id: true },
    });
    return { itemId: item.id };
  });
}

/** Records the tech's verdict — the condition that drives recommendations. */
export async function setInspectionItemCondition(
  input: InspectionServiceInput & {
    itemId: string;
    condition: InspectionItemCondition;
    note?: string;
  },
): Promise<void> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );

  if (!CONDITIONS.has(input.condition)) throw new InspectionFailed("invalid_condition");

  await input.db.$transaction(async (transaction) => {
    const item = await transaction.inspectionItem.findFirst({
      where: { id: input.itemId, organizationId: input.context.organizationId },
      select: { id: true, inspectionId: true, inspection: { select: { status: true } } },
    });
    if (!item) throw new InspectionFailed("item_not_found");
    if (item.inspection.status !== "draft") throw new InspectionFailed("not_draft");

    await transaction.inspectionItem.update({
      where: { id: item.id },
      data: {
        condition: input.condition,
        ...(input.note !== undefined ? { note: input.note.trim() || null } : {}),
        // Marking REPLACE flags the item as a recommendation candidate.
        recommended: input.condition === "REPLACE",
      },
    });
  });
}

/**
 * Completes the inspection. The immutable copy is what sharing serves.
 */
export async function completeInspection(
  input: InspectionServiceInput & { inspectionId: string },
): Promise<void> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );

  await input.db.$transaction(async (transaction) => {
    const inspection = await loadDraft(transaction, input.context, input.inspectionId);
    await transaction.inspection.update({
      where: { id: inspection.id },
      data: { status: "completed", completedAt: new Date() },
    });
    await transaction.activityEvent.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        locationId: inspection.locationId,
        workOrderId: inspection.workOrderId,
        actorUserId: input.context.actorId,
        eventType: "inspection.completed",
        summary: `Inspection "${inspection.title}" completed.`,
      },
    });
  });
}

/**
 * Mints the customer share token (tracker pattern): a signed-by-random,
 * single-purpose URL with no account attached.
 */
export async function shareInspection(
  input: InspectionServiceInput & { inspectionId: string },
): Promise<Readonly<{ token: string }>> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );

  const inspection = await input.db.inspection.findFirst({
    where: { id: input.inspectionId, organizationId: input.context.organizationId },
    select: { id: true, status: true, sharedToken: true },
  });
  if (!inspection) throw new InspectionFailed("inspection_not_found");
  if (inspection.status === "draft") throw new InspectionFailed("not_draft");
  if (inspection.sharedToken) return { token: inspection.sharedToken };

  const token = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
  await input.db.inspection.update({
    where: { id: inspection.id },
    data: { sharedToken: token, status: "shared" },
  });
  return { token };
}

/**
 * Lists recommended (REPLACE) items — the bridge to the estimate. The UI
 * turns each into a canned-job / estimate line.
 */
export async function listRecommendedItems(
  input: InspectionServiceInput & { inspectionId: string },
): Promise<
  readonly Readonly<{ id: string; component: string; zone: string | null; note: string | null }>[]
> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.read",
  );

  const items = await input.db.inspectionItem.findMany({
    where: {
      organizationId: input.context.organizationId,
      inspectionId: input.inspectionId,
      recommended: true,
    },
    orderBy: { position: "asc" },
    select: { id: true, component: true, zone: true, note: true },
  });
  return items;
}

async function loadDraft(
  transaction: TransactionalClient,
  context: TenantContext,
  inspectionId: string,
) {
  const inspection = await transaction.inspection.findFirst({
    where: { id: inspectionId, organizationId: context.organizationId },
    select: { id: true, locationId: true, workOrderId: true, title: true, status: true },
  });
  if (!inspection) throw new InspectionFailed("inspection_not_found");
  if (inspection.status !== "draft") throw new InspectionFailed("not_draft");
  return inspection;
}
