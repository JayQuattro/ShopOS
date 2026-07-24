import type { PrismaClient } from "@/generated/prisma/client";

import { BUILT_IN_ROLE_TEMPLATES, type BuiltInRoleTemplate } from "./built-in-role-templates";

type TransactionalClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$use" | "$extends"
>;

export type BuiltInRoleKey = BuiltInRoleTemplate["key"];

/**
 * The keys of the six built-in role templates. Custom roles are a later
 * capability; role assignment today is constrained to these keys so the
 * privilege-escalation guard can reason about a closed permission surface.
 */
export const BUILT_IN_ROLE_KEYS: readonly BuiltInRoleKey[] = BUILT_IN_ROLE_TEMPLATES.map(
  (template) => template.key,
);

export type OwnerCheckMembership = Readonly<{
  authRole: string;
  roles: ReadonlyArray<{ role: { key: string } }>;
}>;

export class InvalidBuiltInRole extends Error {
  constructor(public readonly roleKey: string) {
    super(`"${roleKey}" is not a recognized built-in role key.`);
    this.name = "InvalidBuiltInRole";
  }
}

/**
 * Narrows an arbitrary string to a built-in role key, throwing `InvalidBuiltInRole`
 * for unrecognized values. Used at the transport boundary so service code can
 * treat the key as the closed union.
 */
export function requireBuiltInRoleKey(roleKey: string): BuiltInRoleKey {
  if (BUILT_IN_ROLE_KEYS.includes(roleKey as BuiltInRoleKey)) {
    return roleKey as BuiltInRoleKey;
  }
  throw new InvalidBuiltInRole(roleKey);
}

/**
 * Returns the built-in role template for a key. Throws for unrecognized keys;
 * callers should narrow with `requireBuiltInRoleKey` first.
 */
export function builtInRoleTemplate(key: BuiltInRoleKey): BuiltInRoleTemplate {
  const template = BUILT_IN_ROLE_TEMPLATES.find((candidate) => candidate.key === key);
  if (!template) {
    throw new InvalidBuiltInRole(key);
  }
  return template;
}

export class RoleEscalationDenied extends Error {
  constructor(public readonly roleKey: BuiltInRoleKey) {
    super("The requested role grants permissions the actor does not hold.");
    this.name = "RoleEscalationDenied";
  }
}

/**
 * Privilege-escalation guard: an actor may only assign a role whose permissions
 * are a subset of their own resolved permissions. This prevents a manager (who
 * lacks `organizations.manage`) from granting the owner or administrator role
 * (both carry `organizations.manage`). Returns the validated template or throws
 * `RoleEscalationDenied`.
 */
export function assertRoleGrantable(
  roleKey: BuiltInRoleKey,
  actorPermissions: ReadonlySet<string>,
): BuiltInRoleTemplate {
  const template = builtInRoleTemplate(roleKey);
  for (const permission of template.permissions) {
    if (!actorPermissions.has(permission)) {
      throw new RoleEscalationDenied(roleKey);
    }
  }
  return template;
}

/**
 * A membership is an "owner" if its Better Auth role is `owner` or it carries
 * the built-in `owner` role. Both signals are checked because onboarding sets
 * `authRole: "owner"` and links the owner role, but either alone is sufficient
 * to trigger last-owner protection.
 */
export function isOwnerMembership(membership: OwnerCheckMembership): boolean {
  if (membership.authRole === "owner") {
    return true;
  }
  return membership.roles.some((assignment) => assignment.role.key === "owner");
}

/**
 * Counts the active memberships in an organization that satisfy
 * `isOwnerMembership`. Used inside the serializable transaction that precedes a
 * deactivate or owner-role revocation to enforce the last-owner invariant.
 */
export async function countActiveOwners(
  transaction: TransactionalClient,
  organizationId: string,
): Promise<number> {
  const memberships = await transaction.organizationMembership.findMany({
    where: { organizationId, active: true },
    select: {
      authRole: true,
      roles: { select: { role: { select: { key: true } } } },
    },
  });
  return (memberships as unknown as OwnerCheckMembership[]).filter(isOwnerMembership).length;
}

export class LastOwnerProtected extends Error {
  constructor() {
    super("The organization must retain at least one active owner.");
    this.name = "LastOwnerProtected";
  }
}
