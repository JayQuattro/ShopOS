import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import { assertTenantAccess, type TenantContext } from "@/modules/tenancy/policy";

export type WorkPreferences = Readonly<{
  changeOrderCreditPolicy: "AUTO_APPLY" | "REQUIRE_APPROVAL";
  invoiceLinePolicy: "APPROVED_ONLY" | "ALL_LINES";
  taxDisplayMode: "EXCLUSIVE" | "INCLUSIVE";
  einvoiceFormat: "factur-x" | "xrechnung" | "fatturapa" | null;
  weekStartsOn: 0 | 1;
  defaultPaperSize: "LETTER" | "A4" | "LEGAL";
  qualityCheckRequired: boolean;
  authorizationLinkTtlHours: number;
  workOrderNumberPrefix: string;
  invoiceNumberPrefix: string;
  defaultLaborRateMinor: number;
  defaultTaxRateBasisPoints: number;
  reviewUrl: string | null;
}>;

export class WorkPreferencesFailed extends Error {
  constructor(
    public readonly reason:
      | "organization_not_found"
      | "invalid_link_ttl"
      | "invalid_prefix"
      | "invalid_rates"
      | "invalid_review_url",
  ) {
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
    select: {
      changeOrderCreditPolicy: true,
      invoiceLinePolicy: true,
      taxDisplayMode: true,
      einvoiceFormat: true,
      weekStartsOn: true,
      defaultPaperSize: true,
      qualityCheckRequired: true,
      authorizationLinkTtlHours: true,
      workOrderNumberPrefix: true,
      invoiceNumberPrefix: true,
      defaultLaborRateMinor: true,
      defaultTaxRateBasisPoints: true,
      reviewUrl: true,
    },
  });
  if (!organization) throw new WorkPreferencesFailed("organization_not_found");

  return {
    changeOrderCreditPolicy: organization.changeOrderCreditPolicy,
    invoiceLinePolicy: organization.invoiceLinePolicy,
    taxDisplayMode: organization.taxDisplayMode === "INCLUSIVE" ? "INCLUSIVE" : "EXCLUSIVE",
    weekStartsOn: organization.weekStartsOn === 1 ? 1 : 0,
    einvoiceFormat: ["factur-x", "xrechnung", "fatturapa"].includes(
      organization.einvoiceFormat ?? "",
    )
      ? (organization.einvoiceFormat as NonNullable<WorkPreferences["einvoiceFormat"]>)
      : null,
    defaultPaperSize: organization.defaultPaperSize,
    qualityCheckRequired: organization.qualityCheckRequired,
    authorizationLinkTtlHours: organization.authorizationLinkTtlHours,
    workOrderNumberPrefix: organization.workOrderNumberPrefix,
    invoiceNumberPrefix: organization.invoiceNumberPrefix,
    defaultLaborRateMinor: Number(organization.defaultLaborRateMinor),
    defaultTaxRateBasisPoints: organization.defaultTaxRateBasisPoints,
    reviewUrl: organization.reviewUrl,
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

  if (
    !Number.isSafeInteger(preferences.authorizationLinkTtlHours) ||
    preferences.authorizationLinkTtlHours < 1 ||
    preferences.authorizationLinkTtlHours > 720
  ) {
    throw new WorkPreferencesFailed("invalid_link_ttl");
  }
  for (const prefix of [preferences.workOrderNumberPrefix, preferences.invoiceNumberPrefix]) {
    if (prefix.trim().length < 1 || prefix.trim().length > 12) {
      throw new WorkPreferencesFailed("invalid_prefix");
    }
  }
  if (
    !Number.isSafeInteger(preferences.defaultLaborRateMinor) ||
    preferences.defaultLaborRateMinor < 0 ||
    !Number.isSafeInteger(preferences.defaultTaxRateBasisPoints) ||
    preferences.defaultTaxRateBasisPoints < 0 ||
    preferences.defaultTaxRateBasisPoints > 10000
  ) {
    throw new WorkPreferencesFailed("invalid_rates");
  }
  if (preferences.reviewUrl && !/^https?:\/\//.test(preferences.reviewUrl.trim())) {
    throw new WorkPreferencesFailed("invalid_review_url");
  }

  await db.$transaction(async (transaction) => {
    const update = await transaction.organization.updateMany({
      where: { id: context.organizationId },
      data: {
        changeOrderCreditPolicy: preferences.changeOrderCreditPolicy,
        invoiceLinePolicy: preferences.invoiceLinePolicy,
        taxDisplayMode: preferences.taxDisplayMode,
        einvoiceFormat: preferences.einvoiceFormat,
        weekStartsOn: preferences.weekStartsOn,
        defaultPaperSize: preferences.defaultPaperSize,
        qualityCheckRequired: preferences.qualityCheckRequired,
        authorizationLinkTtlHours: preferences.authorizationLinkTtlHours,
        workOrderNumberPrefix: preferences.workOrderNumberPrefix.trim(),
        invoiceNumberPrefix: preferences.invoiceNumberPrefix.trim(),
        defaultLaborRateMinor: BigInt(preferences.defaultLaborRateMinor),
        defaultTaxRateBasisPoints: preferences.defaultTaxRateBasisPoints,
        reviewUrl: preferences.reviewUrl ? preferences.reviewUrl.trim() : null,
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
