import type { PrismaClient } from "@/generated/prisma/client";
import { assertTenantAccess, type TenantContext } from "@/modules/tenancy/policy";

export type RegionalSettingsServiceInput = Readonly<{ db: PrismaClient; context: TenantContext }>;

export class RegionalSettingsFailed extends Error {
  constructor(
    public readonly reason: "location_not_found" | "invalid_currency" | "invalid_locale",
  ) {
    super("The regional settings operation could not be completed.");
    this.name = "RegionalSettingsFailed";
  }
}

export type RegionalSettings = Readonly<{
  currency: string;
  locale: string;
}>;

const DEFAULT_CURRENCY = "USD";
const DEFAULT_LOCALE = "en-US";

const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const LOCALE_PATTERN = /^[a-z]{2,3}(-[A-Z][a-zA-Z]{0,7})*$/;

export function isValidCurrencyCode(value: string): boolean {
  return CURRENCY_PATTERN.test(value);
}

export function isValidLocaleTag(value: string): boolean {
  return LOCALE_PATTERN.test(value) && Intl.NumberFormat.supportedLocalesOf([value]).length === 1;
}

/**
 * Effective regional settings for money and customer-facing formatting:
 * the location's overrides when set, otherwise the organization's defaults,
 * otherwise USD / en-US. Locale never implies currency or time zone
 * (ADR 0010) — they resolve independently.
 */
type TransactionalClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$use" | "$extends"
>;

export async function resolveRegionalSettings(
  db: PrismaClient | TransactionalClient,
  organizationId: string,
  locationId?: string,
): Promise<RegionalSettings> {
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { defaultCurrency: true, defaultLocale: true },
  });

  let locationCurrency: string | null = null;
  let locationLocale: string | null = null;
  if (locationId) {
    // Scoped lookup: a location id from another organization resolves to
    // nothing, so its overrides can never leak across tenants.
    const location = await db.location.findFirst({
      where: { id: locationId, organizationId },
      select: { currency: true, locale: true },
    });
    locationCurrency = location?.currency ?? null;
    locationLocale = location?.locale ?? null;
  }

  return {
    currency: locationCurrency ?? org?.defaultCurrency ?? DEFAULT_CURRENCY,
    locale: locationLocale ?? org?.defaultLocale ?? DEFAULT_LOCALE,
  };
}

/**
 * Per-location overrides: null clears back to the organization default.
 */
export async function updateLocationRegionalSettings(
  input: RegionalSettingsServiceInput & {
    locationId: string;
    currency?: string | null;
    locale?: string | null;
  },
): Promise<RegionalSettings> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId, locationId: input.locationId },
    "organizations.manage",
  );

  const clean = (value: string | null | undefined): string | null => {
    const trimmed = (value ?? "").trim();
    return trimmed.length > 0 ? trimmed : null;
  };

  const currency = clean(input.currency);
  if (currency && !isValidCurrencyCode(currency)) {
    throw new RegionalSettingsFailed("invalid_currency");
  }
  const locale = clean(input.locale);
  if (locale && !isValidLocaleTag(locale)) {
    throw new RegionalSettingsFailed("invalid_locale");
  }

  const updated = await input.db.location.updateMany({
    where: {
      id: input.locationId,
      organizationId: input.context.organizationId,
    },
    data: {
      ...(currency !== undefined || input.currency === null ? { currency } : {}),
      ...(locale !== undefined || input.locale === null ? { locale } : {}),
    },
  });
  if (updated.count !== 1) throw new RegionalSettingsFailed("location_not_found");

  return resolveRegionalSettings(input.db, input.context.organizationId, input.locationId);
}
