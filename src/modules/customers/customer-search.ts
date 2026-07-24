import type { PrismaClient } from "@/generated/prisma/client";
import { assertTenantAccess, type TenantContext } from "@/modules/tenancy/policy";

export type CustomerSearchResult = Readonly<{
  id: string;
  displayName: string;
  kind: string;
  organizationReference: string | null;
  primaryEmail: string | null;
  primaryPhone: string | null;
}>;

export type AssetSearchResult = Readonly<{
  id: string;
  customerId: string;
  displayName: string;
  category: string;
  manufacturer: string | null;
  model: string | null;
}>;

const DEFAULT_SEARCH_LIMIT = 20;
const MAX_SEARCH_LIMIT = 50;

/**
 * Tenant-scoped customer search. Queries are scoped by organizationId BEFORE
 * text matching so no cross-tenant data is exposed. Matches across displayName,
 * organizationReference, primaryEmail, primaryPhone, and contact names/emails.
 */
export async function searchCustomers(
  input: Readonly<{ db: PrismaClient; context: TenantContext; query: string; limit?: number }>,
): Promise<readonly CustomerSearchResult[]> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "customers.read",
  );

  const limit = Math.min(input.limit ?? DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT);
  const query = input.query.trim();
  if (!query) return [];

  const customers = await input.db.customer.findMany({
    where: {
      organizationId: input.context.organizationId,
      archivedAt: null,
      OR: [
        { displayName: { contains: query, mode: "insensitive" } },
        { organizationReference: { contains: query, mode: "insensitive" } },
        { primaryEmail: { contains: query, mode: "insensitive" } },
        { primaryPhone: { contains: query, mode: "insensitive" } },
        {
          contacts: {
            some: {
              OR: [
                { name: { contains: query, mode: "insensitive" } },
                { email: { contains: query, mode: "insensitive" } },
              ],
            },
          },
        },
      ],
    },
    select: {
      id: true,
      displayName: true,
      kind: true,
      organizationReference: true,
      primaryEmail: true,
      primaryPhone: true,
    },
    take: limit,
    orderBy: { displayName: "asc" },
  });

  return customers.map((c) => ({
    id: c.id,
    displayName: c.displayName,
    kind: c.kind,
    organizationReference: c.organizationReference,
    primaryEmail: c.primaryEmail,
    primaryPhone: c.primaryPhone,
  }));
}

/**
 * Tenant-scoped asset search. Matches across displayName, manufacturer, model,
 * and serialNumber.
 */
export async function searchAssets(
  input: Readonly<{ db: PrismaClient; context: TenantContext; query: string; limit?: number }>,
): Promise<readonly AssetSearchResult[]> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "assets.read",
  );

  const limit = Math.min(input.limit ?? DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT);
  const query = input.query.trim();
  if (!query) return [];

  const assets = await input.db.asset.findMany({
    where: {
      organizationId: input.context.organizationId,
      OR: [
        { displayName: { contains: query, mode: "insensitive" } },
        { manufacturer: { contains: query, mode: "insensitive" } },
        { model: { contains: query, mode: "insensitive" } },
        { serialNumber: { contains: query, mode: "insensitive" } },
      ],
    },
    select: {
      id: true,
      customerId: true,
      displayName: true,
      category: true,
      manufacturer: true,
      model: true,
    },
    take: limit,
    orderBy: { displayName: "asc" },
  });

  return assets.map((a) => ({
    id: a.id,
    customerId: a.customerId,
    displayName: a.displayName,
    category: a.category,
    manufacturer: a.manufacturer,
    model: a.model,
  }));
}
