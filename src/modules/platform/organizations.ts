import { randomUUID } from "node:crypto";

import type { OrganizationStatus, PrismaClient } from "@/generated/prisma/client";

import {
  assertPlatformPermission,
  revalidatePlatformGrant,
  type PlatformContext,
} from "./authorization";

export type PlatformOrganizationSummary = Readonly<{
  id: string;
  name: string;
  slug: string;
  status: OrganizationStatus;
  subscriptionState: string;
  defaultCurrency: string;
  locationCount: number;
  membershipCount: number;
  createdAt: Date;
}>;

export async function listPlatformOrganizations(
  db: PrismaClient,
  context: PlatformContext,
): Promise<readonly PlatformOrganizationSummary[]> {
  assertPlatformPermission(context, "platform.organizations.read");

  const organizations = await db.organization.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      subscriptionState: true,
      defaultCurrency: true,
      createdAt: true,
      _count: {
        select: {
          locations: true,
          memberships: true,
        },
      },
    },
  });

  return organizations.map((organization) => ({
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    status: organization.status,
    subscriptionState: organization.subscriptionState,
    defaultCurrency: organization.defaultCurrency,
    locationCount: organization._count.locations,
    membershipCount: organization._count.memberships,
    createdAt: organization.createdAt,
  }));
}

export async function getPlatformOrganization(
  db: PrismaClient,
  context: PlatformContext,
  organizationId: string,
): Promise<Readonly<{
  id: string;
  name: string;
  slug: string;
  status: OrganizationStatus;
  subscriptionState: string;
  defaultCurrency: string;
  createdAt: Date;
  locations: readonly Readonly<{
    id: string;
    code: string;
    name: string;
    timeZone: string;
    active: boolean;
  }>[];
  entitlements: readonly Readonly<{
    id: string;
    key: string;
    enabled: boolean;
    limitValue: string | null;
    source: string;
    expiresAt: Date | null;
  }>[];
  auditEvents: readonly Readonly<{
    id: string;
    action: string;
    reason: string | null;
    occurredAt: Date;
  }>[];
}> | null> {
  assertPlatformPermission(context, "platform.organizations.read");

  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    include: {
      locations: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          code: true,
          name: true,
          timeZone: true,
          active: true,
        },
      },
      entitlements: {
        orderBy: { key: "asc" },
        select: {
          id: true,
          key: true,
          enabled: true,
          limitValue: true,
          source: true,
          expiresAt: true,
        },
      },
      platformAuditEvents: {
        orderBy: { occurredAt: "desc" },
        take: 20,
        select: {
          id: true,
          action: true,
          reason: true,
          occurredAt: true,
        },
      },
    },
  });

  if (!organization) {
    return null;
  }

  return {
    ...organization,
    entitlements: organization.entitlements.map((entitlement) => ({
      ...entitlement,
      limitValue: entitlement.limitValue?.toString() ?? null,
    })),
    auditEvents: organization.platformAuditEvents,
  };
}

export type ChangeOrganizationStatusFailureReason =
  "invalid_transition" | "invalid_reason" | "organization_not_found" | "concurrent_change";

export class ChangeOrganizationStatusFailed extends Error {
  readonly reason: ChangeOrganizationStatusFailureReason;

  constructor(reason: ChangeOrganizationStatusFailureReason) {
    super("The organization lifecycle state could not be changed.");
    this.name = "ChangeOrganizationStatusFailed";
    this.reason = reason;
  }
}

export async function changeOrganizationStatus(
  input: Readonly<{
    db: PrismaClient;
    context: PlatformContext;
    organizationId: string;
    targetStatus: "ACTIVE" | "SUSPENDED";
    reason: string;
  }>,
): Promise<Readonly<{ organizationId: string; status: "ACTIVE" | "SUSPENDED" }>> {
  assertPlatformPermission(input.context, "platform.organizations.suspend");
  await revalidatePlatformGrant(input.db, input.context);

  const reason = input.reason.trim();
  if (reason.length < 10 || reason.length > 500) {
    throw new ChangeOrganizationStatusFailed("invalid_reason");
  }

  return input.db.$transaction(async (transaction) => {
    const organization = await transaction.organization.findUnique({
      where: { id: input.organizationId },
      select: { id: true, status: true },
    });
    if (!organization) {
      throw new ChangeOrganizationStatusFailed("organization_not_found");
    }

    const expectedStatus = input.targetStatus === "SUSPENDED" ? "ACTIVE" : "SUSPENDED";
    if (organization.status !== expectedStatus) {
      throw new ChangeOrganizationStatusFailed("invalid_transition");
    }

    const update = await transaction.organization.updateMany({
      where: {
        id: input.organizationId,
        status: expectedStatus,
      },
      data: {
        status: input.targetStatus,
      },
    });
    if (update.count !== 1) {
      throw new ChangeOrganizationStatusFailed("concurrent_change");
    }

    await transaction.platformAuditEvent.create({
      data: {
        id: randomUUID(),
        actorUserId: input.context.actorId,
        targetOrganizationId: input.organizationId,
        action:
          input.targetStatus === "SUSPENDED"
            ? "organization.suspended"
            : "organization.reactivated",
        targetType: "organization",
        targetId: input.organizationId,
        requestId: input.context.requestId,
        reason,
        metadata: {
          beforeStatus: expectedStatus,
          afterStatus: input.targetStatus,
        },
      },
    });
    await transaction.auditEvent.create({
      data: {
        id: randomUUID(),
        organizationId: input.organizationId,
        actorUserId: input.context.actorId,
        action:
          input.targetStatus === "SUSPENDED"
            ? "organization.suspended"
            : "organization.reactivated",
        entityType: "organization",
        entityId: input.organizationId,
        requestId: input.context.requestId,
        before: { status: expectedStatus },
        after: { status: input.targetStatus },
      },
    });
    await transaction.outboxEvent.create({
      data: {
        id: randomUUID(),
        organizationId: input.organizationId,
        eventType:
          input.targetStatus === "SUSPENDED"
            ? "organization.suspended"
            : "organization.reactivated",
        aggregateType: "organization",
        aggregateId: input.organizationId,
        payload: {
          organizationId: input.organizationId,
          status: input.targetStatus,
        },
      },
    });

    return {
      organizationId: input.organizationId,
      status: input.targetStatus,
    };
  });
}
