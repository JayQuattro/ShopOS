import type { PrismaClient } from "@/generated/prisma/client";

/**
 * Resolves an organization identifier (UUID or slug) to an organization ID.
 * If the input looks like a UUID, queries by ID. Otherwise queries by slug.
 * Returns null if not found.
 */
export async function resolveOrgIdentifier(
  db: PrismaClient,
  identifier: string,
): Promise<string | null> {
  // UUID format check (with or without dashes).
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier);

  if (isUuid) {
    const org = await db.organization.findUnique({
      where: { id: identifier },
      select: { id: true },
    });
    return org?.id ?? null;
  }

  // Try slug lookup.
  const org = await db.organization.findFirst({
    where: { slug: identifier.toLowerCase() },
    select: { id: true },
  });
  return org?.id ?? null;
}
