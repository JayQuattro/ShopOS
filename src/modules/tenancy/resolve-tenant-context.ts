import type { PrismaClient } from "@/generated/prisma/client";

import type { Permission } from "./policy";
import { assertLocationCanBeSelected } from "./policy";

export type TenantContextNotResolvedReason =
  | "unauthenticated"
  | "organization_not_selected"
  | "membership_not_found"
  | "membership_inactive"
  | "location_not_allowed";

export type ResolveTenantContextInput = Readonly<{
  db: PrismaClient;
  actorId: string;
  organizationId: string;
  requestId: string;
  selectedLocationId?: string;
}>;

export class TenantContextNotResolved extends Error {
  readonly reason: TenantContextNotResolvedReason;

  constructor(reason: TenantContextNotResolvedReason) {
    super("The tenant context could not be resolved for this request.");
    this.name = "TenantContextNotResolved";
    this.reason = reason;
  }
}

/**
 * The full set of permissions recognized by ShopOS. Used to narrow the JSON
 * `permissions` arrays stored on roles: unknown strings are dropped rather than
 * thrown, so organizations can introduce candidate permissions without breaking
 * resolution before the type union is widened.
 */
const RECOGNIZED_PERMISSIONS: ReadonlySet<string> = new Set<Permission>([
  "organizations.manage",
  "memberships.manage",
  "customers.read",
  "customers.write",
  "assets.read",
  "assets.write",
  "work_orders.read",
  "work_orders.write",
  "estimates.present",
  "authorizations.record",
  "invoices.issue",
  "payments.record",
]);

/**
 * Rebuilds the authoritative tenant context from server-side membership,
 * role/permission, and location-access records.
 *
 * The client (browser) supplies a candidate organization and optional location
 * only; this function verifies them against stored data. It never trusts the
 * candidate IDs as authority — if no active membership exists for the actor in
 * the candidate organization, resolution fails closed (ADR 0002).
 *
 * The first and only membership query is scoped by `(organizationId, userId)`,
 * so a missing or cross-organization membership returns nothing rather than a
 * row that must be rejected afterward.
 */
export async function resolveTenantContext(input: ResolveTenantContextInput): Promise<
  Readonly<{
    actorId: string;
    organizationId: string;
    membershipId: string;
    requestId: string;
    selectedLocationId?: string;
    organizationWideLocationAccess: boolean;
    allowedLocationIds: ReadonlySet<string>;
    permissions: ReadonlySet<Permission>;
  }>
> {
  const membership = await input.db.organizationMembership.findFirst({
    where: {
      organizationId: input.organizationId,
      userId: input.actorId,
    },
    include: {
      roles: { include: { role: { select: { permissions: true } } } },
      locationAccess: { select: { locationId: true } },
    },
  });

  if (!membership) {
    throw new TenantContextNotResolved("membership_not_found");
  }

  if (!membership.active) {
    throw new TenantContextNotResolved("membership_inactive");
  }

  const permissions = collectPermissions(membership.roles);
  const allowedLocationIds = new Set(membership.locationAccess.map((grant) => grant.locationId));

  const context = {
    actorId: input.actorId,
    organizationId: input.organizationId,
    membershipId: membership.id,
    requestId: input.requestId,
    organizationWideLocationAccess: membership.organizationWideLocationAccess,
    allowedLocationIds,
    permissions,
  } as const;

  if (input.selectedLocationId) {
    assertLocationCanBeSelected(context, input.selectedLocationId);
  }

  return input.selectedLocationId
    ? { ...context, selectedLocationId: input.selectedLocationId }
    : context;
}

/**
 * Unions the JSON permission arrays across all roles linked to a membership,
 * narrowing each element to the recognized `Permission` union. Unknown strings
 * are silently dropped: the DB only constrains that `permissions` is an array,
 * not its element values, so this guard keeps resolution resilient to
 * forward-looking or org-customized role definitions.
 */
function collectPermissions(
  roles: ReadonlyArray<{
    role: { permissions: unknown };
  }>,
): ReadonlySet<Permission> {
  const permissions = new Set<Permission>();
  for (const membershipRole of roles) {
    const raw = membershipRole.role.permissions;
    if (!Array.isArray(raw)) {
      continue;
    }
    for (const candidate of raw) {
      if (typeof candidate === "string" && RECOGNIZED_PERMISSIONS.has(candidate)) {
        permissions.add(candidate as Permission);
      }
    }
  }
  return permissions;
}
