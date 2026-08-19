import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import { assertTenantAccess, type TenantContext } from "@/modules/tenancy/policy";

export type OrgSettingsInput = Readonly<{ db: PrismaClient; context: TenantContext }>;

export class OrgProfileFailed extends Error {
  constructor(
    public readonly reason:
      | "organization_not_found"
      | "invalid_name"
      | "invalid_website"
      | "invalid_country"
      | "invalid_currency"
      | "invalid_locale"
      | "invalid_tax_id",
  ) {
    super("The shop profile operation could not be completed.");
    this.name = "OrgProfileFailed";
  }
}

export type ShopProfile = Readonly<{
  name: string;
  contactPhone: string | null;
  contactEmail: string | null;
  website: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  stateProvince: string | null;
  postalCode: string | null;
  country: string | null;
  defaultCurrency: string;
  defaultLocale: string | null;
  taxId: string | null;
}>;

/**
 * The shop's identity and contact details, used across customer-facing
 * surfaces (tracker, print letterhead, email/SMS signatures).
 */
export async function getShopProfile(
  db: PrismaClient,
  context: TenantContext,
): Promise<ShopProfile> {
  assertTenantAccess(context, { organizationId: context.organizationId }, "organizations.manage");

  const organization = await db.organization.findUnique({
    where: { id: context.organizationId },
    select: {
      name: true,
      contactPhone: true,
      contactEmail: true,
      website: true,
      addressLine1: true,
      addressLine2: true,
      city: true,
      stateProvince: true,
      postalCode: true,
      country: true,
      defaultCurrency: true,
      defaultLocale: true,
      taxId: true,
    },
  });
  if (!organization) throw new OrgProfileFailed("organization_not_found");
  return organization;
}

const WEBSITE_PATTERN = /^https?:\/\/.+/;

/**
 * Updates the shop profile. Empty strings clear optional fields; the website
 * must be an absolute http(s) URL when set, and country an ISO 3166-1 alpha-2
 * code. The audit event records the full before/after.
 */
export async function updateShopProfile(
  db: PrismaClient,
  context: TenantContext,
  profile: Readonly<{
    name: string;
    contactPhone?: string | null;
    contactEmail?: string | null;
    website?: string | null;
    addressLine1?: string | null;
    addressLine2?: string | null;
    city?: string | null;
    stateProvince?: string | null;
    postalCode?: string | null;
    country?: string | null;
    defaultCurrency?: string;
    defaultLocale?: string | null;
    taxId?: string | null;
  }>,
): Promise<void> {
  assertTenantAccess(context, { organizationId: context.organizationId }, "organizations.manage");

  const name = profile.name.trim();
  if (name.length < 2 || name.length > 180) throw new OrgProfileFailed("invalid_name");

  const clean = (value: string | null | undefined): string | null => {
    const trimmed = (value ?? "").trim();
    return trimmed.length > 0 ? trimmed : null;
  };

  const website = clean(profile.website);
  if (website && !WEBSITE_PATTERN.test(website)) throw new OrgProfileFailed("invalid_website");
  const country = clean(profile.country);
  if (country && !/^[A-Za-z]{2}$/.test(country)) throw new OrgProfileFailed("invalid_country");

  const defaultCurrency =
    profile.defaultCurrency !== undefined
      ? profile.defaultCurrency.trim().toUpperCase()
      : undefined;
  if (defaultCurrency !== undefined && !/^[A-Z]{3}$/.test(defaultCurrency)) {
    throw new OrgProfileFailed("invalid_currency");
  }
  const taxId = clean(profile.taxId);
  if (taxId && !/^[A-Za-z0-9.\-/ ]{4,32}$/.test(taxId)) {
    throw new OrgProfileFailed("invalid_tax_id");
  }
  const defaultLocale = clean(profile.defaultLocale);
  if (
    defaultLocale &&
    (!/^[a-z]{2,3}(-[A-Z][a-zA-Z]{0,7})*$/.test(defaultLocale) ||
      Intl.NumberFormat.supportedLocalesOf([defaultLocale]).length !== 1)
  ) {
    throw new OrgProfileFailed("invalid_locale");
  }

  await db.$transaction(async (transaction) => {
    const before = await transaction.organization.findUnique({
      where: { id: context.organizationId },
      select: {
        name: true,
        contactPhone: true,
        contactEmail: true,
        website: true,
        addressLine1: true,
        addressLine2: true,
        city: true,
        stateProvince: true,
        postalCode: true,
        country: true,
        defaultCurrency: true,
        defaultLocale: true,
        taxId: true,
      },
    });
    if (!before) throw new OrgProfileFailed("organization_not_found");

    const after = {
      name,
      contactPhone: clean(profile.contactPhone),
      contactEmail: clean(profile.contactEmail),
      website,
      addressLine1: clean(profile.addressLine1),
      addressLine2: clean(profile.addressLine2),
      city: clean(profile.city),
      stateProvince: clean(profile.stateProvince),
      postalCode: clean(profile.postalCode),
      country: country ? country.toUpperCase() : null,
      ...(defaultCurrency !== undefined ? { defaultCurrency } : {}),
      defaultLocale,
      taxId,
    };

    await transaction.organization.update({
      where: { id: context.organizationId },
      data: after,
    });

    await transaction.auditEvent.create({
      data: {
        id: randomUUID(),
        organizationId: context.organizationId,
        actorUserId: context.actorId,
        action: "organization.profile_updated",
        entityType: "organization",
        entityId: context.organizationId,
        requestId: context.requestId,
        before: { ...before },
        after: { ...after },
      },
    });
  });
}
