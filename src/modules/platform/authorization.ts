import type { PlatformOperatorRole, PrismaClient } from "@/generated/prisma/client";

export type PlatformPermission =
  | "platform.organizations.read"
  | "platform.organizations.provision"
  | "platform.organizations.suspend"
  | "platform.entitlements.manage"
  | "platform.operators.manage"
  | "platform.audit.read";

export type PlatformContext = Readonly<{
  actorId: string;
  operatorGrantId: string;
  role: PlatformOperatorRole;
  requestId: string;
  permissions: ReadonlySet<PlatformPermission>;
}>;

const ROLE_PERMISSIONS: Readonly<Record<PlatformOperatorRole, ReadonlySet<PlatformPermission>>> = {
  VIEWER: new Set(["platform.organizations.read", "platform.audit.read"]),
  OPERATOR: new Set([
    "platform.organizations.read",
    "platform.organizations.provision",
    "platform.organizations.suspend",
    "platform.audit.read",
  ]),
  ADMIN: new Set([
    "platform.organizations.read",
    "platform.organizations.provision",
    "platform.organizations.suspend",
    "platform.entitlements.manage",
    "platform.operators.manage",
    "platform.audit.read",
  ]),
};

export type PlatformContextNotResolvedReason =
  "operator_grant_not_found" | "operator_grant_expired" | "operator_disabled" | "mfa_required";

export class PlatformContextNotResolved extends Error {
  readonly reason: PlatformContextNotResolvedReason;

  constructor(reason: PlatformContextNotResolvedReason) {
    super("Platform administration is not available for this actor.");
    this.name = "PlatformContextNotResolved";
    this.reason = reason;
  }
}

export class PlatformPermissionDenied extends Error {
  constructor() {
    super("The requested platform action is not available.");
    this.name = "PlatformPermissionDenied";
  }
}

export async function resolvePlatformContext(
  input: Readonly<{
    db: PrismaClient;
    actorId: string;
    requestId: string;
    now?: Date;
  }>,
): Promise<PlatformContext> {
  const now = input.now ?? new Date();
  const grant = await input.db.platformOperatorGrant.findFirst({
    where: {
      userId: input.actorId,
      revokedAt: null,
    },
    include: {
      user: {
        select: {
          disabledAt: true,
          twoFactorEnabled: true,
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  if (!grant) {
    throw new PlatformContextNotResolved("operator_grant_not_found");
  }
  if (grant.expiresAt && grant.expiresAt <= now) {
    throw new PlatformContextNotResolved("operator_grant_expired");
  }
  if (grant.user.disabledAt) {
    throw new PlatformContextNotResolved("operator_disabled");
  }
  if (!grant.user.twoFactorEnabled) {
    throw new PlatformContextNotResolved("mfa_required");
  }

  return {
    actorId: input.actorId,
    operatorGrantId: grant.id,
    role: grant.role,
    requestId: input.requestId,
    permissions: new Set(ROLE_PERMISSIONS[grant.role]),
  };
}

export function assertPlatformPermission(
  context: PlatformContext,
  permission: PlatformPermission,
): void {
  if (!context.permissions.has(permission)) {
    throw new PlatformPermissionDenied();
  }
}

export async function revalidatePlatformGrant(
  db: PrismaClient,
  context: PlatformContext,
  now = new Date(),
): Promise<void> {
  const grant = await db.platformOperatorGrant.findFirst({
    where: {
      id: context.operatorGrantId,
      userId: context.actorId,
      role: context.role,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      user: {
        disabledAt: null,
        twoFactorEnabled: true,
      },
    },
    select: { id: true },
  });

  if (!grant) {
    throw new PlatformContextNotResolved("operator_grant_not_found");
  }
}
