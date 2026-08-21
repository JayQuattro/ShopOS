import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import { assertTenantAccess, type TenantContext } from "@/modules/tenancy/policy";

export type DisclaimerServiceInput = Readonly<{ db: PrismaClient; context: TenantContext }>;

export class DisclaimerFailed extends Error {
  constructor(
    public readonly reason:
      | "template_not_found"
      | "duplicate_name"
      | "invalid_name"
      | "invalid_body"
      | "invoice_not_found"
      | "invoice_not_draft"
      | "disclaimer_not_found",
  ) {
    super("The disclaimer operation could not be completed.");
    this.name = "DisclaimerFailed";
  }
}

export type DisclaimerTemplateRow = Readonly<{
  id: string;
  name: string;
  body: string;
  triggerKey: string | null;
  active: boolean;
  /** Display scope for applied rows: job label, line description, or whole invoice. */
  scope?: string | null;
}>;

export async function listTemplates(
  input: DisclaimerServiceInput,
): Promise<readonly DisclaimerTemplateRow[]> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.read",
  );
  const rows = await input.db.disclaimerTemplate.findMany({
    where: { organizationId: input.context.organizationId },
    orderBy: [{ active: "desc" }, { name: "asc" }],
    select: { id: true, name: true, body: true, triggerKey: true, active: true },
  });
  return rows;
}

export async function createTemplate(
  input: DisclaimerServiceInput & {
    name: string;
    body: string;
    triggerKey?: "CUSTOMER_PARTS" | "SUBLET";
    active?: boolean;
  },
): Promise<Readonly<{ templateId: string }>> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );
  const name = input.name.trim();
  const body = input.body.trim();
  if (name.length < 2 || name.length > 120) throw new DisclaimerFailed("invalid_name");
  if (body.length < 2 || body.length > 2000) throw new DisclaimerFailed("invalid_body");

  const existing = await input.db.disclaimerTemplate.findFirst({
    where: { organizationId: input.context.organizationId, name },
    select: { id: true },
  });
  if (existing) throw new DisclaimerFailed("duplicate_name");

  const template = await input.db.disclaimerTemplate.create({
    data: {
      id: randomUUID(),
      organizationId: input.context.organizationId,
      name,
      body,
      ...(input.triggerKey ? { triggerKey: input.triggerKey } : {}),
      ...(input.active === false ? { active: false } : {}),
    },
  });
  return { templateId: template.id };
}

export async function updateTemplate(
  input: DisclaimerServiceInput & {
    templateId: string;
    name?: string;
    body?: string;
    triggerKey?: "CUSTOMER_PARTS" | "SUBLET" | null;
    active?: boolean;
  },
): Promise<void> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.write",
  );
  const template = await input.db.disclaimerTemplate.findFirst({
    where: { id: input.templateId, organizationId: input.context.organizationId },
    select: { id: true },
  });
  if (!template) throw new DisclaimerFailed("template_not_found");

  const name = input.name?.trim();
  if (name !== undefined && (name.length < 2 || name.length > 120)) {
    throw new DisclaimerFailed("invalid_name");
  }
  const body = input.body?.trim();
  if (body !== undefined && (body.length < 2 || body.length > 2000)) {
    throw new DisclaimerFailed("invalid_body");
  }
  if (name !== undefined) {
    const clash = await input.db.disclaimerTemplate.findFirst({
      where: {
        organizationId: input.context.organizationId,
        name,
        id: { not: template.id },
      },
      select: { id: true },
    });
    if (clash) throw new DisclaimerFailed("duplicate_name");
  }

  await input.db.disclaimerTemplate.update({
    where: { id: template.id },
    data: {
      ...(name !== undefined ? { name } : {}),
      ...(body !== undefined ? { body } : {}),
      ...(input.triggerKey !== undefined ? { triggerKey: input.triggerKey } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
    },
  });
}

/**
 * Suggested-but-never-forced: active templates whose situation matches the
 * invoice, excluding ones already applied by name. Templates with no
 * trigger live in the library for manual one-tap add.
 */
export async function suggestedForInvoice(
  input: DisclaimerServiceInput & { invoiceId: string },
): Promise<readonly DisclaimerTemplateRow[]> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.read",
  );
  const invoice = await input.db.invoice.findFirst({
    where: { id: input.invoiceId, organizationId: input.context.organizationId },
    select: { id: true, workOrderId: true },
  });
  if (!invoice) throw new DisclaimerFailed("invoice_not_found");

  const [unlinkedPartLine, sublet] = await Promise.all([
    input.db.invoiceLine.findFirst({
      where: {
        organizationId: input.context.organizationId,
        invoiceId: invoice.id,
        kind: "PART",
        inventoryItemId: null,
      },
      select: { id: true },
    }),
    invoice.workOrderId
      ? input.db.subletWork.findFirst({
          where: {
            organizationId: input.context.organizationId,
            workOrderId: invoice.workOrderId,
          },
          select: { id: true },
        })
      : Promise.resolve(null),
  ]);

  const appliedNames = await input.db.invoiceDisclaimer.findMany({
    where: { organizationId: input.context.organizationId, invoiceId: invoice.id },
    select: { name: true },
  });
  const applied = new Set(appliedNames.map((row) => row.name));

  const templates = await input.db.disclaimerTemplate.findMany({
    where: {
      organizationId: input.context.organizationId,
      active: true,
      triggerKey: { not: null },
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true, body: true, triggerKey: true, active: true },
  });

  return templates.filter((template) => {
    if (applied.has(template.name)) return false;
    if (template.triggerKey === "CUSTOMER_PARTS") return unlinkedPartLine !== null;
    if (template.triggerKey === "SUBLET") return sublet !== null;
    return false;
  });
}

export async function applyDisclaimer(
  input: DisclaimerServiceInput & {
    invoiceId: string;
    templateId?: string;
    name?: string;
    body?: string;
    /** Attach to a job (group key) or a single invoice line; omit for invoice-wide. */
    serviceGroupKey?: string;
    invoiceLineId?: string;
  },
): Promise<Readonly<{ disclaimerId: string }>> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "invoices.issue",
  );

  let name = input.name?.trim();
  let body = input.body?.trim();
  if (input.templateId) {
    const template = await input.db.disclaimerTemplate.findFirst({
      where: { id: input.templateId, organizationId: input.context.organizationId },
      select: { name: true, body: true },
    });
    if (!template) throw new DisclaimerFailed("template_not_found");
    name = template.name;
    body = template.body;
  }
  if (!name || name.length < 2 || name.length > 120) {
    throw new DisclaimerFailed("invalid_name");
  }
  if (!body || body.length < 2 || body.length > 2000) {
    throw new DisclaimerFailed("invalid_body");
  }

  const invoice = await input.db.invoice.findFirst({
    where: { id: input.invoiceId, organizationId: input.context.organizationId },
    select: { id: true, status: true },
  });
  if (!invoice) throw new DisclaimerFailed("invoice_not_found");
  // Snapshots are part of the document; once issued, the invoice is history.
  if (invoice.status !== "DRAFT") throw new DisclaimerFailed("invoice_not_draft");

  // Scope resolution: the line (or any line of the named job) must belong
  // to this invoice in this tenant; the job label is snapshotted for display.
  let serviceGroupLabel: string | null = null;
  let invoiceLineId: string | null = null;
  const scopeLine =
    input.invoiceLineId || input.serviceGroupKey
      ? await input.db.invoiceLine.findFirst({
          where: {
            organizationId: input.context.organizationId,
            invoiceId: invoice.id,
            ...(input.invoiceLineId
              ? { id: input.invoiceLineId }
              : { sourceEstimateLine: { serviceGroupKey: input.serviceGroupKey! } }),
          },
          select: {
            id: true,
            sourceEstimateLine: { select: { serviceGroupKey: true, serviceGroupLabel: true } },
          },
        })
      : null;
  if (input.invoiceLineId || input.serviceGroupKey) {
    if (!scopeLine) throw new DisclaimerFailed("disclaimer_not_found");
    invoiceLineId = input.invoiceLineId ? scopeLine.id : null;
    const group = scopeLine.sourceEstimateLine;
    serviceGroupLabel =
      group?.serviceGroupLabel ??
      (group && group.serviceGroupKey !== "general" ? group.serviceGroupKey : null);
  }

  const last = await input.db.invoiceDisclaimer.findFirst({
    where: { invoiceId: invoice.id },
    orderBy: { position: "desc" },
    select: { position: true },
  });

  const disclaimer = await input.db.invoiceDisclaimer.create({
    data: {
      id: randomUUID(),
      organizationId: input.context.organizationId,
      invoiceId: invoice.id,
      name,
      body,
      position: (last?.position ?? 0) + 1,
      ...(input.serviceGroupKey ? { serviceGroupKey: input.serviceGroupKey } : {}),
      ...(serviceGroupLabel ? { serviceGroupLabel } : {}),
      ...(invoiceLineId ? { invoiceLineId } : {}),
    },
  });
  return { disclaimerId: disclaimer.id };
}

export async function removeDisclaimer(
  input: DisclaimerServiceInput & { invoiceId: string; disclaimerId: string },
): Promise<void> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "invoices.issue",
  );
  const invoice = await input.db.invoice.findFirst({
    where: { id: input.invoiceId, organizationId: input.context.organizationId },
    select: { id: true, status: true },
  });
  if (!invoice) throw new DisclaimerFailed("invoice_not_found");
  if (invoice.status !== "DRAFT") throw new DisclaimerFailed("invoice_not_draft");

  const disclaimer = await input.db.invoiceDisclaimer.findFirst({
    where: {
      id: input.disclaimerId,
      organizationId: input.context.organizationId,
      invoiceId: invoice.id,
    },
    select: { id: true },
  });
  if (!disclaimer) throw new DisclaimerFailed("disclaimer_not_found");
  await input.db.invoiceDisclaimer.delete({ where: { id: disclaimer.id } });
}

export async function listApplied(
  input: DisclaimerServiceInput & { invoiceId: string },
): Promise<readonly DisclaimerTemplateRow[]> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "work_orders.read",
  );
  const rows = await input.db.invoiceDisclaimer.findMany({
    where: { organizationId: input.context.organizationId, invoiceId: input.invoiceId },
    orderBy: { position: "asc" },
    select: {
      id: true,
      name: true,
      body: true,
      serviceGroupLabel: true,
      invoiceLineId: true,
      invoiceLine: { select: { description: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    body: row.body,
    triggerKey: null,
    active: true,
    scope: row.invoiceLine?.description ?? row.serviceGroupLabel ?? "Whole invoice",
  }));
}
