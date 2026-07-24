import { randomUUID } from "node:crypto";

import type { PlatformOperatorRole, PrismaClient } from "@/generated/prisma/client";

import {
  assertPlatformPermission,
  revalidatePlatformGrant,
  type PlatformContext,
} from "./authorization";

export type OperatorGrantSummary = Readonly<{
  id: string;
  userId: string;
  userEmail: string;
  userDisplayName: string;
  role: PlatformOperatorRole;
  reason: string;
  status: "active" | "expiring" | "expired" | "revoked";
  expiresAt: Date | null;
  revokedAt: Date | null;
  revocationReason: string | null;
  grantedByUserId: string | null;
  grantedByDisplayName: string | null;
  createdAt: Date;
}>;

export type OperatorGrantFailureReason =
  | "invalid_reason"
  | "target_user_not_found"
  | "target_user_not_eligible"
  | "target_already_has_grant"
  | "grant_not_found"
  | "already_revoked"
  | "last_admin_protected"
  | "invalid_expiry"
  | "self_grant_forbidden";

export class OperatorGrantFailed extends Error {
  readonly reason: OperatorGrantFailureReason;

  constructor(reason: OperatorGrantFailureReason) {
    super("The operator grant operation could not be completed.");
    this.name = "OperatorGrantFailed";
    this.reason = reason;
  }
}

const EXPIRING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export async function listOperatorGrants(
  db: PrismaClient,
  context: PlatformContext,
): Promise<readonly OperatorGrantSummary[]> {
  assertPlatformPermission(context, "platform.operators.manage");

  const grants = await db.platformOperatorGrant.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      userId: true,
      role: true,
      reason: true,
      expiresAt: true,
      revokedAt: true,
      revocationReason: true,
      grantedByUserId: true,
      createdAt: true,
      user: { select: { email: true, displayName: true } },
      grantedBy: { select: { displayName: true } },
    },
  });

  const now = Date.now();

  return grants.map((grant) => {
    let status: OperatorGrantSummary["status"];
    if (grant.revokedAt) {
      status = "revoked";
    } else if (grant.expiresAt && grant.expiresAt.getTime() <= now) {
      status = "expired";
    } else if (grant.expiresAt && grant.expiresAt.getTime() <= now + EXPIRING_WINDOW_MS) {
      status = "expiring";
    } else {
      status = "active";
    }

    return {
      id: grant.id,
      userId: grant.userId,
      userEmail: grant.user.email,
      userDisplayName: grant.user.displayName,
      role: grant.role,
      reason: grant.reason,
      status,
      expiresAt: grant.expiresAt,
      revokedAt: grant.revokedAt,
      revocationReason: grant.revocationReason,
      grantedByUserId: grant.grantedByUserId,
      grantedByDisplayName: grant.grantedBy?.displayName ?? null,
      createdAt: grant.createdAt,
    };
  });
}

export async function grantOperatorRole(
  input: Readonly<{
    db: PrismaClient;
    context: PlatformContext;
    targetUserId: string;
    role: PlatformOperatorRole;
    reason: string;
    expiresAt?: Date;
  }>,
): Promise<Readonly<{ grantId: string }>> {
  assertPlatformPermission(input.context, "platform.operators.manage");
  await revalidatePlatformGrant(input.db, input.context);

  const trimmedReason = input.reason.trim();
  if (trimmedReason.length < 10 || trimmedReason.length > 500) {
    throw new OperatorGrantFailed("invalid_reason");
  }

  if (input.expiresAt && input.expiresAt.getTime() <= Date.now()) {
    throw new OperatorGrantFailed("invalid_expiry");
  }

  // Self-grant is forbidden: an admin cannot grant themselves a second grant.
  if (input.targetUserId === input.context.actorId) {
    throw new OperatorGrantFailed("self_grant_forbidden");
  }

  return input.db.$transaction(async (transaction) => {
    const targetUser = await transaction.user.findUnique({
      where: { id: input.targetUserId },
      select: { id: true, emailVerified: true, twoFactorEnabled: true, disabledAt: true },
    });
    if (!targetUser) {
      throw new OperatorGrantFailed("target_user_not_found");
    }
    if (!targetUser.emailVerified || !targetUser.twoFactorEnabled || targetUser.disabledAt) {
      throw new OperatorGrantFailed("target_user_not_eligible");
    }

    const existingActive = await transaction.platformOperatorGrant.findFirst({
      where: { userId: input.targetUserId, revokedAt: null },
      select: { id: true },
    });
    if (existingActive) {
      throw new OperatorGrantFailed("target_already_has_grant");
    }

    const grant = await transaction.platformOperatorGrant.create({
      data: {
        id: randomUUID(),
        userId: input.targetUserId,
        role: input.role,
        reason: trimmedReason,
        grantedByUserId: input.context.actorId,
        ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
      },
    });

    await transaction.platformAuditEvent.create({
      data: {
        id: randomUUID(),
        actorUserId: input.context.actorId,
        action: "platform.operator.granted",
        targetType: "user",
        targetId: input.targetUserId,
        requestId: input.context.requestId,
        reason: trimmedReason,
        metadata: { role: input.role, grantId: grant.id },
      },
    });

    return { grantId: grant.id };
  });
}

export async function revokeOperatorGrant(
  input: Readonly<{
    db: PrismaClient;
    context: PlatformContext;
    grantId: string;
    reason: string;
  }>,
): Promise<void> {
  assertPlatformPermission(input.context, "platform.operators.manage");
  await revalidatePlatformGrant(input.db, input.context);

  const trimmedReason = input.reason.trim();
  if (trimmedReason.length < 10 || trimmedReason.length > 500) {
    throw new OperatorGrantFailed("invalid_reason");
  }

  await input.db.$transaction(
    async (transaction) => {
      const grant = await transaction.platformOperatorGrant.findUnique({
        where: { id: input.grantId },
        select: { id: true, userId: true, role: true, revokedAt: true },
      });
      if (!grant) {
        throw new OperatorGrantFailed("grant_not_found");
      }
      if (grant.revokedAt) {
        throw new OperatorGrantFailed("already_revoked");
      }

      // Last-admin safety: cannot revoke the final active ADMIN grant.
      if (grant.role === "ADMIN") {
        const activeAdminCount = await transaction.platformOperatorGrant.count({
          where: {
            role: "ADMIN",
            revokedAt: null,
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          },
        });
        if (activeAdminCount <= 1) {
          throw new OperatorGrantFailed("last_admin_protected");
        }
      }

      const update = await transaction.platformOperatorGrant.updateMany({
        where: { id: input.grantId, revokedAt: null },
        data: {
          revokedAt: new Date(),
          revokedByUserId: input.context.actorId,
          revocationReason: trimmedReason,
        },
      });
      if (update.count !== 1) {
        throw new OperatorGrantFailed("already_revoked");
      }

      await transaction.platformAuditEvent.create({
        data: {
          id: randomUUID(),
          actorUserId: input.context.actorId,
          action: "platform.operator.revoked",
          targetType: "user",
          targetId: grant.userId,
          requestId: input.context.requestId,
          reason: trimmedReason,
          metadata: { grantId: input.grantId, revokedRole: grant.role },
        },
      });
    },
    { isolationLevel: "Serializable" },
  );
}

export async function extendOperatorGrant(
  input: Readonly<{
    db: PrismaClient;
    context: PlatformContext;
    grantId: string;
    newExpiresAt: Date | null;
    reason: string;
  }>,
): Promise<void> {
  assertPlatformPermission(input.context, "platform.operators.manage");
  await revalidatePlatformGrant(input.db, input.context);

  const trimmedReason = input.reason.trim();
  if (trimmedReason.length < 10 || trimmedReason.length > 500) {
    throw new OperatorGrantFailed("invalid_reason");
  }

  if (input.newExpiresAt && input.newExpiresAt.getTime() <= Date.now()) {
    throw new OperatorGrantFailed("invalid_expiry");
  }

  await input.db.$transaction(async (transaction) => {
    const grant = await transaction.platformOperatorGrant.findUnique({
      where: { id: input.grantId },
      select: { id: true, userId: true, revokedAt: true, expiresAt: true },
    });
    if (!grant) {
      throw new OperatorGrantFailed("grant_not_found");
    }
    if (grant.revokedAt) {
      throw new OperatorGrantFailed("already_revoked");
    }

    await transaction.platformOperatorGrant.update({
      where: { id: input.grantId },
      data: { ...(input.newExpiresAt ? { expiresAt: input.newExpiresAt } : { expiresAt: null }) },
    });

    await transaction.platformAuditEvent.create({
      data: {
        id: randomUUID(),
        actorUserId: input.context.actorId,
        action: "platform.operator.extended",
        targetType: "user",
        targetId: grant.userId,
        requestId: input.context.requestId,
        reason: trimmedReason,
        metadata: {
          grantId: input.grantId,
          previousExpiresAt: grant.expiresAt?.toISOString() ?? null,
          newExpiresAt: input.newExpiresAt?.toISOString() ?? null,
        },
      },
    });
  });
}
