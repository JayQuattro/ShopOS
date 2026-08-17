import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import type { TransactionalClient } from "@/modules/estimates/estimate-service";
import { addLine, createDraftRevision } from "@/modules/estimates/estimate-service";
import { addTask } from "@/modules/work-orders/task-service";
import { assertTenantAccess, type TenantContext } from "@/modules/tenancy/policy";

export type TemplateServiceInput = Readonly<{ db: PrismaClient; context: TenantContext }>;

export class ServiceTemplateFailed extends Error {
  constructor(
    public readonly reason:
      | "invalid_name"
      | "duplicate_name"
      | "invalid_lines"
      | "invalid_tasks"
      | "template_not_found"
      | "work_order_not_found"
      | "empty_template",
  ) {
    super("The service template operation could not be completed.");
    this.name = "ServiceTemplateFailed";
  }
}

export type TemplateLineInput = Readonly<{
  kind: "LABOR" | "PART" | "FEE";
  serviceGroupKey: string;
  description: string;
  quantityMilli: number;
  unitPriceMinor: number;
  taxable: boolean;
  taxRateBasisPoints: number;
}>;

export type TemplateTaskInput = Readonly<{ title: string }>;

/**
 * Creates a service-menu template: a saved job (priced lines) and/or an
 * inspection sheet (task titles) that can be applied to work orders.
 */
export async function createServiceTemplate(
  input: TemplateServiceInput & {
    name: string;
    notes?: string;
    lines: ReadonlyArray<TemplateLineInput>;
    tasks: ReadonlyArray<TemplateTaskInput>;
  },
): Promise<Readonly<{ templateId: string }>> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );

  const name = input.name.trim();
  if (name.length < 2 || name.length > 180) throw new ServiceTemplateFailed("invalid_name");

  if (input.lines.length === 0 && input.tasks.length === 0) {
    throw new ServiceTemplateFailed("empty_template");
  }
  for (const line of input.lines) {
    if (
      line.description.trim().length < 2 ||
      !Number.isSafeInteger(line.quantityMilli) ||
      line.quantityMilli < 1 ||
      !Number.isSafeInteger(line.unitPriceMinor) ||
      line.unitPriceMinor < 0 ||
      !Number.isSafeInteger(line.taxRateBasisPoints) ||
      line.taxRateBasisPoints < 0 ||
      line.serviceGroupKey.trim().length < 1
    ) {
      throw new ServiceTemplateFailed("invalid_lines");
    }
  }
  for (const task of input.tasks) {
    if (task.title.trim().length < 3 || task.title.trim().length > 200) {
      throw new ServiceTemplateFailed("invalid_tasks");
    }
  }

  const existing = await input.db.serviceTemplate.findFirst({
    where: { organizationId: input.context.organizationId, name },
    select: { id: true },
  });
  if (existing) throw new ServiceTemplateFailed("duplicate_name");

  const template = await input.db.serviceTemplate.create({
    data: {
      id: randomUUID(),
      organizationId: input.context.organizationId,
      name,
      ...(input.notes ? { notes: input.notes.trim() } : {}),
    },
  });

  let position = 0;
  for (const line of input.lines) {
    position += 1;
    await input.db.serviceTemplateLine.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        serviceTemplateId: template.id,
        position,
        kind: line.kind,
        serviceGroupKey: line.serviceGroupKey.trim(),
        description: line.description.trim(),
        quantityMilli: line.quantityMilli,
        unitPriceMinor: BigInt(line.unitPriceMinor),
        taxable: line.taxable,
        taxRateBasisPoints: line.taxRateBasisPoints,
      },
    });
  }
  position = 0;
  for (const task of input.tasks) {
    position += 1;
    await input.db.serviceTemplateTask.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        serviceTemplateId: template.id,
        position,
        title: task.title.trim(),
      },
    });
  }

  return { templateId: template.id };
}

export type ServiceTemplateSummary = Readonly<{
  id: string;
  name: string;
  notes: string | null;
  lines: ReadonlyArray<
    Readonly<{
      id: string;
      kind: string;
      description: string;
      quantityMilli: number;
      unitPriceMinor: string;
      taxable: boolean;
    }>
  >;
  tasks: ReadonlyArray<Readonly<{ id: string; title: string }>>;
}>;

export async function listServiceTemplates(
  input: TemplateServiceInput,
): Promise<readonly ServiceTemplateSummary[]> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.read",
  );

  const templates = await input.db.serviceTemplate.findMany({
    where: { organizationId: input.context.organizationId },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      notes: true,
      lines: { orderBy: { position: "asc" } },
      tasks: { orderBy: { position: "asc" } },
    },
  });

  return templates.map((template) => ({
    id: template.id,
    name: template.name,
    notes: template.notes,
    lines: template.lines.map((line) => ({
      id: line.id,
      kind: line.kind,
      description: line.description,
      quantityMilli: line.quantityMilli,
      unitPriceMinor: line.unitPriceMinor.toString(),
      taxable: line.taxable,
    })),
    tasks: template.tasks.map((task) => ({ id: task.id, title: task.title })),
  }));
}

export async function deleteServiceTemplate(
  input: TemplateServiceInput & { templateId: string },
): Promise<void> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );

  const template = await input.db.serviceTemplate.findFirst({
    where: { id: input.templateId, organizationId: input.context.organizationId },
    select: { id: true },
  });
  if (!template) throw new ServiceTemplateFailed("template_not_found");

  await input.db.serviceTemplate.delete({ where: { id: template.id } });
}

/**
 * Applies a template to a work order: task titles are appended to the
 * checklist, and priced lines are appended to the latest DRAFT baseline
 * revision — creating one when none exists (currency inherited from the
 * latest presented revision, else the organization default).
 */
export async function applyServiceTemplateToWorkOrder(
  input: TemplateServiceInput & { workOrderId: string; templateId: string },
): Promise<Readonly<{ linesAdded: number; tasksAdded: number; revisionId: string | null }>> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );

  const template = await input.db.serviceTemplate.findFirst({
    where: { id: input.templateId, organizationId: input.context.organizationId },
    select: {
      id: true,
      name: true,
      lines: { orderBy: { position: "asc" } },
      tasks: { orderBy: { position: "asc" } },
    },
  });
  if (!template) throw new ServiceTemplateFailed("template_not_found");

  const workOrder = await input.db.workOrder.findFirst({
    where: { id: input.workOrderId, organizationId: input.context.organizationId },
    select: { id: true, locationId: true },
  });
  if (!workOrder) throw new ServiceTemplateFailed("work_order_not_found");

  // Find or create the draft baseline revision for the lines.
  let revisionId: string | null = null;
  if (template.lines.length > 0) {
    const existingDraft = await input.db.estimateRevision.findFirst({
      where: {
        organizationId: input.context.organizationId,
        workOrderId: workOrder.id,
        status: "DRAFT",
        documentKind: "BASELINE",
      },
      orderBy: { revisionNumber: "desc" },
      select: { id: true },
    });
    if (existingDraft) {
      revisionId = existingDraft.id;
    } else {
      const latestPresented = await input.db.estimateRevision.findFirst({
        where: {
          organizationId: input.context.organizationId,
          workOrderId: workOrder.id,
          status: { in: ["PRESENTED", "SUPERSEDED"] },
        },
        orderBy: { revisionNumber: "desc" },
        select: { currency: true },
      });
      const org = await input.db.organization.findUnique({
        where: { id: input.context.organizationId },
        select: { defaultCurrency: true },
      });
      const created = await createDraftRevision({
        db: input.db,
        context: input.context,
        workOrderId: workOrder.id,
        currency: latestPresented?.currency ?? org?.defaultCurrency ?? "USD",
      });
      revisionId = created.revisionId;
    }

    let position = await nextLinePosition(input.db, revisionId);
    for (const line of template.lines) {
      position += 1;
      await addLine({
        db: input.db,
        context: input.context,
        revisionId,
        kind: line.kind,
        serviceGroupKey: line.serviceGroupKey,
        description: line.description,
        quantityMilli: line.quantityMilli,
        unitPriceMinor: Number(line.unitPriceMinor),
        discountMinor: 0,
        taxable: line.taxable,
        taxRateBasisPoints: line.taxRateBasisPoints,
        position,
      });
    }
  }

  for (const task of template.tasks) {
    await addTask({
      db: input.db,
      context: input.context,
      workOrderId: workOrder.id,
      title: task.title,
    });
  }

  await recordActivity(input.db, input.context, {
    workOrderId: workOrder.id,
    locationId: workOrder.locationId,
    eventType: "template.applied",
    summary: `Template "${template.name}" applied${
      template.lines.length > 0
        ? ` (${template.lines.length} lines` +
          (template.tasks.length > 0 ? `, ${template.tasks.length} tasks)` : ")")
        : template.tasks.length > 0
          ? ` (${template.tasks.length} tasks)`
          : ""
    }.`,
  });

  return {
    linesAdded: template.lines.length,
    tasksAdded: template.tasks.length,
    revisionId,
  };
}

async function nextLinePosition(db: PrismaClient | TransactionalClient, revisionId: string) {
  const latest = await db.estimateLine.findFirst({
    where: { estimateRevisionId: revisionId },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  return latest?.position ?? 0;
}

async function recordActivity(
  db: PrismaClient,
  context: TenantContext,
  input: Readonly<{
    workOrderId: string;
    locationId: string;
    eventType: string;
    summary: string;
  }>,
): Promise<void> {
  await db.activityEvent.create({
    data: {
      id: randomUUID(),
      organizationId: context.organizationId,
      locationId: input.locationId,
      workOrderId: input.workOrderId,
      actorUserId: context.actorId,
      eventType: input.eventType,
      summary: input.summary,
    },
  });
}
