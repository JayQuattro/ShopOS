import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import { assertTenantAccess, type TenantContext } from "@/modules/tenancy/policy";
import { getCurrentSession } from "@/modules/identity/session";

import { builtInRoleTemplate } from "./role-policy";
import {
  assertRoleGrantable,
  countActiveOwners,
  isOwnerMembership,
  LastOwnerProtected,
  requireBuiltInRoleKey,
  type OwnerCheckMembership,
} from "./role-policy";

const INVITATION_TTL_DAYS = 7;

/**
 * The subset of the Prisma client available inside a `$transaction` callback.
 * The transaction client omits `$connect`/`$disconnect`/`$on`/`$extends`, so we
 * type the helpers against this structural interface rather than the full
 * `PrismaClient`.
 */
type TransactionalClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$use" | "$extends"
>;

export type MembershipServiceInput = Readonly<{
  db: PrismaClient;
  context: TenantContext;
}>;

export class MemberMutationFailed extends Error {
  constructor(
    public readonly reason:
      | "membership_not_found"
      | "role_not_found"
      | "location_not_found"
      | "role_already_assigned"
      | "location_already_granted"
      | "duplicate_pending_invitation"
      | "membership_inactive",
  ) {
    super("The membership mutation could not be completed.");
    this.name = "MemberMutationFailed";
  }
}

export class InvitationAcceptanceFailed extends Error {
  constructor(
    public readonly reason:
      | "not_found"
      | "expired"
      | "already_used"
      | "email_mismatch"
      | "email_unverified"
      | "existing_membership",
  ) {
    super("The invitation could not be accepted.");
    this.name = "InvitationAcceptanceFailed";
  }
}

function assertCanManageMemberships(context: TenantContext): void {
  assertTenantAccess(context, { organizationId: context.organizationId }, "memberships.manage");
}

function recordTenantAudit(
  transaction: TransactionalClient,
  args: {
    organizationId: string;
    actorUserId: string;
    requestId: string;
    action: string;
    entityType: string;
    entityId: string;
    before?: unknown;
    after?: unknown;
  },
) {
  return transaction.auditEvent.create({
    data: {
      id: randomUUID(),
      organizationId: args.organizationId,
      actorUserId: args.actorUserId,
      action: args.action,
      entityType: args.entityType,
      entityId: args.entityId,
      requestId: args.requestId,
      ...(args.before !== undefined ? { before: args.before as object } : {}),
      ...(args.after !== undefined ? { after: args.after as object } : {}),
    },
  });
}

function recordOutbox(
  transaction: TransactionalClient,
  args: {
    organizationId: string;
    eventType: string;
    aggregateType: string;
    aggregateId: string;
    payload: object;
  },
) {
  return transaction.outboxEvent.create({
    data: {
      id: randomUUID(),
      organizationId: args.organizationId,
      eventType: args.eventType,
      aggregateType: args.aggregateType,
      aggregateId: args.aggregateId,
      payload: args.payload,
    },
  });
}

/**
 * Creates a pending organization invitation. The invitation records the
 * intended role but does NOT create a membership — the invitee must accept with
 * a matching, verified email. A duplicate pending invitation for the same email
 * is rejected.
 */
export async function inviteMember(
  input: MembershipServiceInput & { email: string; roleKey: string },
): Promise<Readonly<{ invitationId: string; expiresAt: Date }>> {
  assertCanManageMemberships(input.context);
  const roleKey = requireBuiltInRoleKey(input.roleKey);
  const email = input.email.trim().toLowerCase();

  return input.db.$transaction(async (transaction) => {
    const existing = await transaction.organizationInvitation.findFirst({
      where: {
        organizationId: input.context.organizationId,
        email,
        status: "pending",
      },
      select: { id: true },
    });
    if (existing) {
      throw new MemberMutationFailed("duplicate_pending_invitation");
    }

    const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);
    const invitation = await transaction.organizationInvitation.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        inviterId: input.context.actorId,
        email,
        role: roleKey,
        status: "pending",
        expiresAt,
      },
    });

    await recordTenantAudit(transaction, {
      organizationId: input.context.organizationId,
      actorUserId: input.context.actorId,
      requestId: input.context.requestId,
      action: "membership.invited",
      entityType: "invitation",
      entityId: invitation.id,
      after: { email, role: roleKey, expiresAt: expiresAt.toISOString() },
    });
    await recordOutbox(transaction, {
      organizationId: input.context.organizationId,
      eventType: "membership.invited",
      aggregateType: "invitation",
      aggregateId: invitation.id,
      payload: { email, role: roleKey },
    });

    return { invitationId: invitation.id, expiresAt };
  });
}

export async function cancelInvitation(
  input: MembershipServiceInput & { invitationId: string },
): Promise<void> {
  assertCanManageMemberships(input.context);

  await input.db.$transaction(async (transaction) => {
    const update = await transaction.organizationInvitation.updateMany({
      where: {
        id: input.invitationId,
        organizationId: input.context.organizationId,
        status: "pending",
      },
      data: { status: "canceled" },
    });
    if (update.count !== 1) {
      // Not found, already used, or belongs to another org — fail closed.
      throw new MemberMutationFailed("membership_not_found");
    }

    await recordTenantAudit(transaction, {
      organizationId: input.context.organizationId,
      actorUserId: input.context.actorId,
      requestId: input.context.requestId,
      action: "membership.invitation_canceled",
      entityType: "invitation",
      entityId: input.invitationId,
    });
  });
}

/**
 * Accepts an invitation. The acceptor's identity comes from their authenticated
 * session, not from the invitation or any browser-supplied claim. The email must
 * match, be verified, and the invitation must be pending and unexpired.
 *
 * This function deliberately does NOT take a TenantContext for the target org:
 * the acceptor may have no membership in the inviting org yet. It resolves the
 * invitation, verifies ownership of the email, then creates the membership
 * inside a serializable transaction with an atomic status flip.
 */
export async function acceptInvitation(
  input: Readonly<{ db: PrismaClient; invitationId: string }>,
): Promise<Readonly<{ organizationId: string; membershipId: string }>> {
  const session = await getCurrentSession();
  if (!session) {
    throw new InvitationAcceptanceFailed("email_unverified");
  }

  const db = input.db;
  return db.$transaction(
    async (transaction) => {
      const invitation = await transaction.organizationInvitation.findUnique({
        where: { id: input.invitationId },
      });
      if (!invitation) {
        throw new InvitationAcceptanceFailed("not_found");
      }
      if (invitation.status !== "pending") {
        throw new InvitationAcceptanceFailed("already_used");
      }
      if (invitation.expiresAt <= new Date()) {
        throw new InvitationAcceptanceFailed("expired");
      }

      const acceptorEmail = session.user.email.trim().toLowerCase();
      if (acceptorEmail !== invitation.email) {
        throw new InvitationAcceptanceFailed("email_mismatch");
      }
      if (!("emailVerified" in session.user) || !session.user.emailVerified) {
        throw new InvitationAcceptanceFailed("email_unverified");
      }

      const existingMembership = await transaction.organizationMembership.findFirst({
        where: { organizationId: invitation.organizationId, userId: session.user.id },
        select: { id: true },
      });
      if (existingMembership) {
        throw new InvitationAcceptanceFailed("existing_membership");
      }

      const roleKey = invitation.role ? requireBuiltInRoleKey(invitation.role) : "advisor";
      const role = await transaction.role.findFirst({
        where: { organizationId: invitation.organizationId, key: roleKey },
        select: { id: true, key: true },
      });
      if (!role) {
        throw new InvitationAcceptanceFailed("not_found");
      }

      // Atomic status flip prevents double-acceptance under concurrency.
      const flip = await transaction.organizationInvitation.updateMany({
        where: { id: invitation.id, status: "pending" },
        data: { status: "accepted" },
      });
      if (flip.count !== 1) {
        throw new InvitationAcceptanceFailed("already_used");
      }

      const membershipId = randomUUID();
      await transaction.organizationMembership.create({
        data: {
          id: membershipId,
          organizationId: invitation.organizationId,
          userId: session.user.id,
          authRole: roleKey,
          organizationWideLocationAccess: false,
        },
      });
      await transaction.membershipRole.create({
        data: {
          organizationId: invitation.organizationId,
          membershipId,
          roleId: role.id,
        },
      });

      await recordTenantAudit(transaction, {
        organizationId: invitation.organizationId,
        actorUserId: session.user.id,
        requestId: `invitation-accept:${invitation.id}`,
        action: "membership.created",
        entityType: "membership",
        entityId: membershipId,
        after: { userId: session.user.id, role: roleKey, invitationId: invitation.id },
      });
      await recordOutbox(transaction, {
        organizationId: invitation.organizationId,
        eventType: "membership.created",
        aggregateType: "membership",
        aggregateId: membershipId,
        payload: { userId: session.user.id, role: roleKey },
      });

      return { organizationId: invitation.organizationId, membershipId };
    },
    { isolationLevel: "Serializable" },
  );
}

export async function assignRole(
  input: MembershipServiceInput & { membershipId: string; roleKey: string },
): Promise<void> {
  assertCanManageMemberships(input.context);
  const roleKey = requireBuiltInRoleKey(input.roleKey);
  // Privilege-escalation guard: the role's permissions must be a subset of the
  // actor's own resolved permissions.
  assertRoleGrantable(roleKey, input.context.permissions);

  await input.db.$transaction(async (transaction) => {
    const membership = await transaction.organizationMembership.findFirst({
      where: {
        id: input.membershipId,
        organizationId: input.context.organizationId,
      },
      select: { id: true, userId: true, active: true, authRole: true },
    });
    if (!membership) {
      throw new MemberMutationFailed("membership_not_found");
    }

    const role = await transaction.role.findFirst({
      where: { organizationId: input.context.organizationId, key: roleKey },
      select: { id: true },
    });
    if (!role) {
      throw new MemberMutationFailed("role_not_found");
    }

    const existing = await transaction.membershipRole.findUnique({
      where: { membershipId_roleId: { membershipId: membership.id, roleId: role.id } },
      select: { roleId: true },
    });
    if (existing) {
      throw new MemberMutationFailed("role_already_assigned");
    }

    await transaction.membershipRole.create({
      data: {
        organizationId: input.context.organizationId,
        membershipId: membership.id,
        roleId: role.id,
      },
    });

    await recordTenantAudit(transaction, {
      organizationId: input.context.organizationId,
      actorUserId: input.context.actorId,
      requestId: input.context.requestId,
      action: "membership.role_assigned",
      entityType: "membership",
      entityId: membership.id,
      after: { userId: membership.userId, role: roleKey },
    });
    await recordOutbox(transaction, {
      organizationId: input.context.organizationId,
      eventType: "membership.role_assigned",
      aggregateType: "membership",
      aggregateId: membership.id,
      payload: { role: roleKey },
    });
  });
}

export async function revokeRole(
  input: MembershipServiceInput & { membershipId: string; roleKey: string },
): Promise<void> {
  assertCanManageMemberships(input.context);
  const roleKey = requireBuiltInRoleKey(input.roleKey);

  await input.db.$transaction(
    async (transaction) => {
      const membership = await loadMembershipForOwnerCheck(
        transaction,
        input.context.organizationId,
        input.membershipId,
      );
      if (!membership) {
        throw new MemberMutationFailed("membership_not_found");
      }

      const role = await transaction.role.findFirst({
        where: { organizationId: input.context.organizationId, key: roleKey },
        select: { id: true },
      });
      if (!role) {
        throw new MemberMutationFailed("role_not_found");
      }

      const link = await transaction.membershipRole.findUnique({
        where: { membershipId_roleId: { membershipId: membership.id, roleId: role.id } },
      });
      if (!link) {
        throw new MemberMutationFailed("role_not_found");
      }

      // If revoking the owner role, enforce the last-owner invariant: simulate
      // the removal and confirm at least one owner remains.
      if (roleKey === "owner") {
        await assertNotLastOwner(transaction, input.context.organizationId);
      }

      await transaction.membershipRole.delete({
        where: { membershipId_roleId: { membershipId: membership.id, roleId: role.id } },
      });

      await recordTenantAudit(transaction, {
        organizationId: input.context.organizationId,
        actorUserId: input.context.actorId,
        requestId: input.context.requestId,
        action: "membership.role_revoked",
        entityType: "membership",
        entityId: membership.id,
        before: { role: roleKey },
      });
      await recordOutbox(transaction, {
        organizationId: input.context.organizationId,
        eventType: "membership.role_revoked",
        aggregateType: "membership",
        aggregateId: membership.id,
        payload: { role: roleKey },
      });
    },
    { isolationLevel: "Serializable" },
  );
}

export async function grantLocationAccess(
  input: MembershipServiceInput & { membershipId: string; locationId: string },
): Promise<void> {
  assertCanManageMemberships(input.context);

  await input.db.$transaction(async (transaction) => {
    const membership = await transaction.organizationMembership.findFirst({
      where: { id: input.membershipId, organizationId: input.context.organizationId },
      select: { id: true, userId: true },
    });
    if (!membership) {
      throw new MemberMutationFailed("membership_not_found");
    }

    // Location must belong to the same organization (compound tenant FK enforced
    // at DB level, but we scope the query to avoid a cross-org leak).
    const location = await transaction.location.findFirst({
      where: { id: input.locationId, organizationId: input.context.organizationId },
      select: { id: true, code: true },
    });
    if (!location) {
      throw new MemberMutationFailed("location_not_found");
    }

    const existing = await transaction.locationAccess.findUnique({
      where: {
        membershipId_locationId: { membershipId: membership.id, locationId: location.id },
      },
    });
    if (existing) {
      throw new MemberMutationFailed("location_already_granted");
    }

    await transaction.locationAccess.create({
      data: {
        organizationId: input.context.organizationId,
        membershipId: membership.id,
        locationId: location.id,
      },
    });

    await recordTenantAudit(transaction, {
      organizationId: input.context.organizationId,
      actorUserId: input.context.actorId,
      requestId: input.context.requestId,
      action: "membership.location_granted",
      entityType: "membership",
      entityId: membership.id,
      after: { userId: membership.userId, locationId: location.id, locationCode: location.code },
    });
    await recordOutbox(transaction, {
      organizationId: input.context.organizationId,
      eventType: "membership.location_granted",
      aggregateType: "membership",
      aggregateId: membership.id,
      payload: { locationId: location.id },
    });
  });
}

export async function revokeLocationAccess(
  input: MembershipServiceInput & { membershipId: string; locationId: string },
): Promise<void> {
  assertCanManageMemberships(input.context);

  await input.db.$transaction(async (transaction) => {
    const membership = await transaction.organizationMembership.findFirst({
      where: { id: input.membershipId, organizationId: input.context.organizationId },
      select: { id: true },
    });
    if (!membership) {
      throw new MemberMutationFailed("membership_not_found");
    }

    const deleted = await transaction.locationAccess.deleteMany({
      where: {
        membershipId: membership.id,
        locationId: input.locationId,
        organizationId: input.context.organizationId,
      },
    });
    if (deleted.count === 0) {
      throw new MemberMutationFailed("location_not_found");
    }

    await recordTenantAudit(transaction, {
      organizationId: input.context.organizationId,
      actorUserId: input.context.actorId,
      requestId: input.context.requestId,
      action: "membership.location_revoked",
      entityType: "membership",
      entityId: membership.id,
      before: { locationId: input.locationId },
    });
    await recordOutbox(transaction, {
      organizationId: input.context.organizationId,
      eventType: "membership.location_revoked",
      aggregateType: "membership",
      aggregateId: membership.id,
      payload: { locationId: input.locationId },
    });
  });
}

export async function deactivateMembership(
  input: MembershipServiceInput & { membershipId: string },
): Promise<void> {
  assertCanManageMemberships(input.context);

  await input.db.$transaction(
    async (transaction) => {
      const membership = await loadMembershipForOwnerCheck(
        transaction,
        input.context.organizationId,
        input.membershipId,
      );
      if (!membership) {
        throw new MemberMutationFailed("membership_not_found");
      }
      if (!membership.active) {
        throw new MemberMutationFailed("membership_inactive");
      }

      // Last-owner invariant: deactivating an owner must not leave zero owners.
      if (isOwnerMembership(membership)) {
        await assertNotLastOwner(transaction, input.context.organizationId);
      }

      const update = await transaction.organizationMembership.updateMany({
        where: { id: membership.id, active: true },
        data: { active: false },
      });
      if (update.count !== 1) {
        throw new MemberMutationFailed("membership_inactive");
      }

      await recordTenantAudit(transaction, {
        organizationId: input.context.organizationId,
        actorUserId: input.context.actorId,
        requestId: input.context.requestId,
        action: "membership.deactivated",
        entityType: "membership",
        entityId: membership.id,
        before: { active: true },
        after: { active: false },
      });
      await recordOutbox(transaction, {
        organizationId: input.context.organizationId,
        eventType: "membership.deactivated",
        aggregateType: "membership",
        aggregateId: membership.id,
        payload: {},
      });
    },
    { isolationLevel: "Serializable" },
  );
}

export async function reactivateMembership(
  input: MembershipServiceInput & { membershipId: string },
): Promise<void> {
  assertCanManageMemberships(input.context);

  await input.db.$transaction(async (transaction) => {
    const update = await transaction.organizationMembership.updateMany({
      where: {
        id: input.membershipId,
        organizationId: input.context.organizationId,
        active: false,
      },
      data: { active: true },
    });
    if (update.count !== 1) {
      throw new MemberMutationFailed("membership_not_found");
    }

    await recordTenantAudit(transaction, {
      organizationId: input.context.organizationId,
      actorUserId: input.context.actorId,
      requestId: input.context.requestId,
      action: "membership.reactivated",
      entityType: "membership",
      entityId: input.membershipId,
      before: { active: false },
      after: { active: true },
    });
    await recordOutbox(transaction, {
      organizationId: input.context.organizationId,
      eventType: "membership.reactivated",
      aggregateType: "membership",
      aggregateId: input.membershipId,
      payload: {},
    });
  });
}

async function loadMembershipForOwnerCheck(
  transaction: TransactionalClient,
  organizationId: string,
  membershipId: string,
): Promise<(OwnerCheckMembership & { id: string; active: boolean }) | null> {
  const membership = await transaction.organizationMembership.findFirst({
    where: { id: membershipId, organizationId },
    select: {
      id: true,
      active: true,
      authRole: true,
      roles: { select: { role: { select: { key: true } } } },
    },
  });
  if (!membership) {
    return null;
  }
  return membership;
}

/**
 * Asserts that removing the owner status from the protected membership would
 * still leave the organization with at least one other active owner. Throws
 * `LastOwnerProtected` if it would not.
 */
async function assertNotLastOwner(
  transaction: TransactionalClient,
  organizationId: string,
): Promise<void> {
  const ownerCount = await countActiveOwners(transaction, organizationId);
  // The caller is acting on an owner membership; subtract one to model the
  // hypothetical post-removal/deactivation state.
  const ownersAfterRemoval = ownerCount - 1;
  if (ownersAfterRemoval < 1) {
    throw new LastOwnerProtected();
  }
}

// Re-export for route error mapping.
export { LastOwnerProtected, builtInRoleTemplate };
