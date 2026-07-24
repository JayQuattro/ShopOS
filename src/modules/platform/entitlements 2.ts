import { randomUUID } from "node:crypto";

import type { PrismaClient, SubscriptionState } from "@/generated/prisma/client";

import {
  assertPlatformPermission,
  revalidatePlatformGrant,
  type PlatformContext,
} from "./authorization";
import { isPlanKey, resolvePlanEntitlements, type PlanKey } from "./plans";

export type EntitlementSummary = Readonly<{
  id: string;
  key: string;
  enabled: boolean;
  limitValue: string | null;
  source: string;
  expiresAt: Date | null;
}>;

export type EntitlementOperationFailureReason =
  | "invalid_reason"
  | "organization_not_found"
  | "invalid_plan_key"
  | "invalid_transition"
  | "concurrent_change";

export class EntitlementOperationFailed extends Error {
  readonly reason: EntitlementOperationFailureReason;

  constructor(reason: EntitlementOperationFailureReason) {
    super("The entitlement operation could not be completed.");
    this.name = "EntitlementOperationFailed";
    this.reason = reason;
  }
}

export async function listEntitlements(
  db: PrismaClient,
  context: PlatformContext,
  organizationId: string,
): Promise<readonly EntitlementSummary[]> {
  assertPlatformPermission(context, "platform.entitlements.manage");

  const entitlements = await db.organizationEntitlement.findMany({
    where: { organizationId },
    orderBy: { key: "asc" },
    select: { id: true, key: true, enabled: true, limitValue: true, source: true, expiresAt: true },
  });

  return entitlements.map((e) => ({
    id: e.id,
    key: e.key,
    enabled: e.enabled,
    limitValue: e.limitValue?.toString() ?? null,
    source: e.source,
    expiresAt: e.expiresAt,
  }));
}

export async function setEntitlement(
  input: Readonly<{
    db: PrismaClient;
    context: PlatformContext;
    organizationId: string;
    key: string;
    enabled?: boolean;
    limitValue?: bigint | null;
    reason: string;
    expiresAt?: Date | null;
  }>,
): Promise<void> {
  assertPlatformPermission(input.context, "platform.entitlements.manage");
  await revalidatePlatformGrant(input.db, input.context);

  const trimmedReason = input.reason.trim();
  if (trimmedReason.length < 10 || trimmedReason.length > 500) {
    throw new EntitlementOperationFailed("invalid_reason");
  }

  await input.db.$transaction(async (transaction) => {
    const org = await transaction.organization.findUnique({
      where: { id: input.organizationId },
      select: { id: true },
    });
    if (!org) {
      throw new EntitlementOperationFailed("organization_not_found");
    }

    await transaction.organizationEntitlement.upsert({
      where: {
        organizationId_key: { organizationId: input.organizationId, key: input.key },
      },
      create: {
        id: randomUUID(),
        organizationId: input.organizationId,
        key: input.key,
        enabled: input.enabled ?? true,
        ...(input.limitValue !== undefined ? { limitValue: input.limitValue } : {}),
        source: "platform",
        updatedByUserId: input.context.actorId,
        ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
      },
      update: {
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.limitValue !== undefined ? { limitValue: input.limitValue } : {}),
        source: "platform",
        updatedByUserId: input.context.actorId,
        ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
      },
    });

    await transaction.platformAuditEvent.create({
      data: {
        id: randomUUID(),
        actorUserId: input.context.actorId,
        targetOrganizationId: input.organizationId,
        action: "platform.entitlement.set",
        targetType: "organization",
        targetId: input.organizationId,
        requestId: input.context.requestId,
        reason: trimmedReason,
        metadata: {
          entitlementKey: input.key,
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        },
      },
    });
  });
}

export async function applyPlan(
  input: Readonly<{
    db: PrismaClient;
    context: PlatformContext;
    organizationId: string;
    planKey: string;
    reason: string;
  }>,
): Promise<Readonly<{ appliedEntitlements: number }>> {
  assertPlatformPermission(input.context, "platform.entitlements.manage");
  await revalidatePlatformGrant(input.db, input.context);

  if (!isPlanKey(input.planKey)) {
    throw new EntitlementOperationFailed("invalid_plan_key");
  }

  const trimmedReason = input.reason.trim();
  if (trimmedReason.length < 10 || trimmedReason.length > 500) {
    throw new EntitlementOperationFailed("invalid_reason");
  }

  const entitlements = resolvePlanEntitlements(input.planKey as PlanKey);
  const source = `plan:${input.planKey}`;

  await input.db.$transaction(async (transaction) => {
    const org = await transaction.organization.findUnique({
      where: { id: input.organizationId },
      select: { id: true },
    });
    if (!org) {
      throw new EntitlementOperationFailed("organization_not_found");
    }

    for (const ent of entitlements) {
      await transaction.organizationEntitlement.upsert({
        where: {
          organizationId_key: { organizationId: input.organizationId, key: ent.key },
        },
        create: {
          id: randomUUID(),
          organizationId: input.organizationId,
          key: ent.key,
          enabled: ent.enabled,
          limitValue: ent.limitValue,
          source,
          updatedByUserId: input.context.actorId,
        },
        update: {
          enabled: ent.enabled,
          limitValue: ent.limitValue,
          source,
          updatedByUserId: input.context.actorId,
          expiresAt: null,
        },
      });
    }

    await transaction.platformAuditEvent.create({
      data: {
        id: randomUUID(),
        actorUserId: input.context.actorId,
        targetOrganizationId: input.organizationId,
        action: "platform.plan.applied",
        targetType: "organization",
        targetId: input.organizationId,
        requestId: input.context.requestId,
        reason: trimmedReason,
        metadata: { planKey: input.planKey },
      },
    });

    await transaction.outboxEvent.create({
      data: {
        id: randomUUID(),
        organizationId: input.organizationId,
        eventType: "platform.plan.applied",
        aggregateType: "organization",
        aggregateId: input.organizationId,
        payload: { planKey: input.planKey },
      },
    });
  });

  return { appliedEntitlements: entitlements.length };
}

export async function transitionSubscriptionState(
  input: Readonly<{
    db: PrismaClient;
    context: PlatformContext;
    organizationId: string;
    newState: SubscriptionState;
    reason: string;
  }>,
): Promise<void> {
  assertPlatformPermission(input.context, "platform.entitlements.manage");
  await revalidatePlatformGrant(input.db, input.context);

  const trimmedReason = input.reason.trim();
  if (trimmedReason.length < 10 || trimmedReason.length > 500) {
    throw new EntitlementOperationFailed("invalid_reason");
  }

  await input.db.$transaction(async (transaction) => {
    const org = await transaction.organization.findUnique({
      where: { id: input.organizationId },
      select: { id: true, subscriptionState: true },
    });
    if (!org) {
      throw new EntitlementOperationFailed("organization_not_found");
    }

    const update = await transaction.organization.updateMany({
      where: { id: input.organizationId, subscriptionState: org.subscriptionState },
      data: { subscriptionState: input.newState },
    });
    if (update.count !== 1) {
      throw new EntitlementOperationFailed("concurrent_change");
    }

    await transaction.platformAuditEvent.create({
      data: {
        id: randomUUID(),
        actorUserId: input.context.actorId,
        targetOrganizationId: input.organizationId,
        action: "platform.subscription.transitioned",
        targetType: "organization",
        targetId: input.organizationId,
        requestId: input.context.requestId,
        reason: trimmedReason,
        metadata: {
          previousState: org.subscriptionState,
          newState: input.newState,
        },
      },
    });
  });
}
