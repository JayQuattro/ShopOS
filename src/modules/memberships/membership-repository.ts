import type { PrismaClient } from "@/generated/prisma/client";
import { assertTenantAccess, type TenantContext } from "@/modules/tenancy/policy";

export type MembershipSummary = Readonly<{
  id: string;
  userId: string;
  displayName: string;
  email: string;
  authRole: string;
  active: boolean;
  organizationWideLocationAccess: boolean;
  roles: readonly Readonly<{ id: string; key: string; name: string }>[];
  locationAccessCount: number;
}>;

export type InvitationSummary = Readonly<{
  id: string;
  email: string;
  role: string | null;
  status: string;
  expiresAt: Date;
  createdAt: Date;
  inviterDisplayName: string;
}>;

/**
 * Tenant-scoped membership and invitation reads.
 *
 * Every query is scoped by the resolved `TenantContext.organizationId` on the
 * first database access (ADR 0002). Organization is never read from untrusted
 * input. These reads carry the `memberships.manage` capability for admin views,
 * but list-only reads may also be satisfied by any member; the caller asserts
 * the appropriate permission.
 */
export class MembershipRepository {
  constructor(private readonly deps: Readonly<{ db: PrismaClient; context: TenantContext }>) {}

  async listMemberships(): Promise<readonly MembershipSummary[]> {
    assertTenantAccess(
      this.deps.context,
      { organizationId: this.deps.context.organizationId },
      "memberships.manage",
    );

    const memberships = await this.deps.db.organizationMembership.findMany({
      where: { organizationId: this.deps.context.organizationId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        userId: true,
        authRole: true,
        active: true,
        organizationWideLocationAccess: true,
        user: { select: { displayName: true, email: true } },
        roles: { select: { role: { select: { id: true, key: true, name: true } } } },
        _count: { select: { locationAccess: true } },
      },
    });

    return memberships.map((membership) => ({
      id: membership.id,
      userId: membership.userId,
      displayName: membership.user.displayName,
      email: membership.user.email,
      authRole: membership.authRole,
      active: membership.active,
      organizationWideLocationAccess: membership.organizationWideLocationAccess,
      roles: membership.roles.map((assignment) => ({
        id: assignment.role.id,
        key: assignment.role.key,
        name: assignment.role.name,
      })),
      locationAccessCount: membership._count.locationAccess,
    }));
  }

  async findMembershipById(id: string): Promise<MembershipSummary | null> {
    assertTenantAccess(
      this.deps.context,
      { organizationId: this.deps.context.organizationId },
      "memberships.manage",
    );

    const membership = await this.deps.db.organizationMembership.findFirst({
      where: { id, organizationId: this.deps.context.organizationId },
      select: {
        id: true,
        userId: true,
        authRole: true,
        active: true,
        organizationWideLocationAccess: true,
        user: { select: { displayName: true, email: true } },
        roles: { select: { role: { select: { id: true, key: true, name: true } } } },
        _count: { select: { locationAccess: true } },
      },
    });

    if (!membership) {
      return null;
    }

    return {
      id: membership.id,
      userId: membership.userId,
      displayName: membership.user.displayName,
      email: membership.user.email,
      authRole: membership.authRole,
      active: membership.active,
      organizationWideLocationAccess: membership.organizationWideLocationAccess,
      roles: membership.roles.map((assignment) => ({
        id: assignment.role.id,
        key: assignment.role.key,
        name: assignment.role.name,
      })),
      locationAccessCount: membership._count.locationAccess,
    };
  }

  async listInvitations(): Promise<readonly InvitationSummary[]> {
    assertTenantAccess(
      this.deps.context,
      { organizationId: this.deps.context.organizationId },
      "memberships.manage",
    );

    const invitations = await this.deps.db.organizationInvitation.findMany({
      where: { organizationId: this.deps.context.organizationId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        expiresAt: true,
        createdAt: true,
        inviter: { select: { displayName: true } },
      },
    });

    return invitations.map((invitation) => ({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
      inviterDisplayName: invitation.inviter.displayName,
    }));
  }

  /** Organization-scoped locations, for the location-grant admin UI. */
  async listLocations(): Promise<
    readonly Readonly<{ id: string; code: string; name: string; active: boolean }>[]
  > {
    assertTenantAccess(
      this.deps.context,
      { organizationId: this.deps.context.organizationId },
      "memberships.manage",
    );

    return this.deps.db.location.findMany({
      where: { organizationId: this.deps.context.organizationId },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true, active: true },
    });
  }
}
