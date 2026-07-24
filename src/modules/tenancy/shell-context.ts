import type { PrismaClient } from "@/generated/prisma/client";
import { getCurrentSession } from "@/modules/identity/session";
import type { TenantContext } from "@/modules/tenancy/policy";
import { getRequestContext } from "@/modules/tenancy/request-context";

export type ShellLocation = Readonly<{
  id: string;
  code: string;
  name: string;
}>;

export type ShellContext = Readonly<{
  tenant: TenantContext;
  user: Readonly<{
    id: string;
    displayName: string;
    email: string;
  }>;
  organization: Readonly<{
    id: string;
    name: string;
    slug: string;
  }>;
  locations: readonly ShellLocation[];
}>;

/**
 * Resolves the display-rich context the application shell needs: the authorized
 * `TenantContext` (for permission checks) plus the organization name/slug, the
 * user's display name/email, and the allowed locations' display fields.
 *
 * This is separate from `TenantContext` (the lean authorization object) so the
 * shell gets display data without bloating every repository call. The session
 * provides the user identity; the tenant context provides the org and
 * permissions; display fields are fetched in scoped queries.
 */
export async function resolveShellContext(db: PrismaClient): Promise<ShellContext> {
  const tenant = await getRequestContext();
  const session = await getCurrentSession();

  if (!session) {
    // getRequestContext already throws when there is no session; this is a
    // type-guard for exhaustiveness.
    throw new Error("Session disappeared between getRequestContext and resolveShellContext.");
  }

  const [organization, user, locations] = await Promise.all([
    db.organization.findUnique({
      where: { id: tenant.organizationId },
      select: { id: true, name: true, slug: true },
    }),
    db.user.findUnique({
      where: { id: tenant.actorId },
      select: { id: true, displayName: true, email: true },
    }),
    tenant.organizationWideLocationAccess
      ? db.location.findMany({
          where: { organizationId: tenant.organizationId, active: true },
          select: { id: true, code: true, name: true },
          orderBy: { code: "asc" },
        })
      : db.location.findMany({
          where: {
            organizationId: tenant.organizationId,
            active: true,
            id: { in: [...tenant.allowedLocationIds] },
          },
          select: { id: true, code: true, name: true },
          orderBy: { code: "asc" },
        }),
  ]);

  if (!organization || !user) {
    throw new Error("Organization or user vanished during shell context resolution.");
  }

  return {
    tenant,
    user: { id: user.id, displayName: user.displayName, email: user.email },
    organization: { id: organization.id, name: organization.name, slug: organization.slug },
    locations,
  };
}
