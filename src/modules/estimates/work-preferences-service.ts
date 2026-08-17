import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import { assertTenantAccess, type TenantContext } from "@/modules/tenancy/policy";

export type WorkPreferences = Readonly<{
  changeOrderCreditPolicy: "AUTO_APPLY" | "REQUIRE_APPROVAL";
  invoiceLinePolicy: "APPROVED_ONLY" | "ALL_LINES";
}>;

export class WorkPreferencesFailed extends Error {
  constructor(public readonly reason: "organization_not_found") {
    super("The work preferences operation could not be completed.");
    this.name = "WorkPreferencesFailed";
  }
}

/**
 * Reads the organization's change-order and invoicing preferences
 * (ADR 0014). Both policies default defensively when unset.
 */
export async function getWorkPreferences(
  db: PrismaClient,
  context: TenantContext,
): Promise<WorkPreferences> {
  assertTenantAccess(context, { organizationId: context.organizationId }, "organizations.manage");

  const organization = await db.organization.findUnique({
    where: { id: context.organizationId },
    select: { changeOrderCreditPolicy: true, invoiceLinePolicy: true },
  });
  if (!organization) throw new WorkPreferencesFailed("organization_not_found");

  return {
    changeOrderCreditPolicy: organization.changeOrderCreditPolicy,
    invoiceLinePolicy: organization.invoiceLinePolicy,
  };
}

/**
 * Updates the organization's change-order and invoicing preferences. These
 * govern future change-order presentations and invoice assembly; issued
 * history is never rewritten (ADR 0014 / ADR 0004).
 */
export async function updateWorkPreferences(
  db: PrismaClient,
  context: TenantContext,
  preferences: WorkPreferences,
): Promise<void> {
  assertTenantAccess(context, { organizationId: context.organizationId }, "organizations.manage");

  await db.$transaction(async (transaction) => {
    const update = await transaction.organization.updateMany({
      where: { id: context.organizationId },
      data: {
        changeOrderCreditPolicy: preferences.changeOrderCreditPolicy,
        invoiceLinePolicy: preferences.invoiceLinePolicy,
      },
    });
    if (update.count !== 1) throw new WorkPreferencesFailed("organization_not_found");

    await transaction.auditEvent.create({
      data: {
        id: randomUUID(),
        organizationId: context.organizationId,
        actorUserId: context.actorId,
        action: "organization.work_preferences_updated",
        entityType: "organization",
        entityId: context.organizationId,
        requestId: context.requestId,
        before: {},
        after: { ...preferences },
      },
    });
  });
}
