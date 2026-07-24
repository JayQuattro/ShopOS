import { createHash, randomUUID } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import { BUILT_IN_ROLE_TEMPLATES } from "@/modules/memberships/built-in-role-templates";
import { assertPlatformPermission, type PlatformContext } from "@/modules/platform/authorization";

type SelfServiceActor = Readonly<{
  kind: "self-service";
  userId: string;
  requestId: string;
}>;

type PlatformActor = Readonly<{
  kind: "platform";
  context: PlatformContext;
  foundingUserId: string;
}>;

export type ProvisionOrganizationInput = Readonly<{
  db: PrismaClient;
  actor: SelfServiceActor | PlatformActor;
  idempotencyKey: string;
  organization: Readonly<{
    name: string;
    slug: string;
    defaultCurrency: string;
  }>;
  firstLocation: Readonly<{
    name: string;
    code: string;
    timeZone: string;
  }>;
}>;

export type ProvisionOrganizationResult = Readonly<{
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  locationId: string;
  locationName: string;
  membershipId: string;
  replayed: boolean;
}>;

export type ProvisionOrganizationFailureReason =
  | "invalid_input"
  | "founding_user_not_eligible"
  | "self_service_limit_reached"
  | "operator_grant_not_active"
  | "idempotency_conflict"
  | "slug_unavailable";

export class ProvisionOrganizationFailed extends Error {
  readonly reason: ProvisionOrganizationFailureReason;

  constructor(reason: ProvisionOrganizationFailureReason) {
    super("The organization could not be provisioned.");
    this.name = "ProvisionOrganizationFailed";
    this.reason = reason;
  }
}

export async function provisionOrganization(
  input: ProvisionOrganizationInput,
): Promise<ProvisionOrganizationResult> {
  const normalized = normalizeInput(input);
  const actorUserId =
    input.actor.kind === "self-service" ? input.actor.userId : input.actor.context.actorId;
  const foundingUserId =
    input.actor.kind === "self-service" ? input.actor.userId : input.actor.foundingUserId;
  const requestId =
    input.actor.kind === "self-service" ? input.actor.requestId : input.actor.context.requestId;
  const actorKind = input.actor.kind === "self-service" ? "SELF_SERVICE" : "PLATFORM_OPERATOR";
  const inputHash = hashProvisioningInput(normalized, foundingUserId);

  if (input.actor.kind === "platform") {
    assertPlatformPermission(input.actor.context, "platform.organizations.provision");
  }

  const replay = await findReplay(
    input.db,
    actorUserId,
    foundingUserId,
    normalized.idempotencyKey,
    inputHash,
  );
  if (replay) {
    return replay;
  }

  try {
    return await input.db.$transaction(
      async (transaction) => {
        const existing = await findReplay(
          transaction,
          actorUserId,
          foundingUserId,
          normalized.idempotencyKey,
          inputHash,
        );
        if (existing) {
          return existing;
        }

        const founder = await transaction.user.findFirst({
          where: {
            id: foundingUserId,
            emailVerified: true,
            disabledAt: null,
          },
          select: { id: true },
        });
        if (!founder) {
          throw new ProvisionOrganizationFailed("founding_user_not_eligible");
        }

        if (input.actor.kind === "self-service") {
          const membershipCount = await transaction.organizationMembership.count({
            where: {
              userId: actorUserId,
              active: true,
            },
          });
          if (membershipCount > 0) {
            throw new ProvisionOrganizationFailed("self_service_limit_reached");
          }
        } else {
          const now = new Date();
          const currentGrant = await transaction.platformOperatorGrant.findFirst({
            where: {
              id: input.actor.context.operatorGrantId,
              userId: input.actor.context.actorId,
              role: input.actor.context.role,
              revokedAt: null,
              OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
              user: {
                disabledAt: null,
                twoFactorEnabled: true,
              },
            },
            select: { id: true },
          });
          if (!currentGrant) {
            throw new ProvisionOrganizationFailed("operator_grant_not_active");
          }
        }

        const organizationId = randomUUID();
        const locationId = randomUUID();
        const membershipId = randomUUID();
        const roleIds = new Map(
          BUILT_IN_ROLE_TEMPLATES.map((template) => [template.key, randomUUID()] as const),
        );
        const ownerRoleId = roleIds.get("owner");
        if (!ownerRoleId) {
          throw new Error("The built-in Owner role template is required.");
        }

        await transaction.organization.create({
          data: {
            id: organizationId,
            name: normalized.organization.name,
            slug: normalized.organization.slug,
            status: "ACTIVE",
            defaultCurrency: normalized.organization.defaultCurrency,
            subscriptionState: "UNMANAGED",
          },
        });
        await transaction.location.create({
          data: {
            id: locationId,
            organizationId,
            name: normalized.firstLocation.name,
            code: normalized.firstLocation.code,
            timeZone: normalized.firstLocation.timeZone,
          },
        });
        await transaction.role.createMany({
          data: BUILT_IN_ROLE_TEMPLATES.map((template) => ({
            id: roleIds.get(template.key) ?? randomUUID(),
            organizationId,
            key: template.key,
            name: template.name,
            permissions: [...template.permissions],
          })),
        });
        await transaction.organizationMembership.create({
          data: {
            id: membershipId,
            organizationId,
            userId: foundingUserId,
            authRole: "owner",
            organizationWideLocationAccess: true,
          },
        });
        await transaction.membershipRole.create({
          data: {
            organizationId,
            membershipId,
            roleId: ownerRoleId,
          },
        });
        await transaction.organizationProvisioningRequest.create({
          data: {
            id: randomUUID(),
            actorUserId,
            actorKind,
            idempotencyKey: normalized.idempotencyKey,
            inputHash,
            organizationId,
          },
        });
        await transaction.auditEvent.create({
          data: {
            id: randomUUID(),
            organizationId,
            locationId,
            actorUserId,
            action: "organization.provisioned",
            entityType: "organization",
            entityId: organizationId,
            requestId,
            after: {
              organizationId,
              locationId,
              foundingUserId,
              role: "owner",
              actorKind,
            },
          },
        });
        await transaction.platformAuditEvent.create({
          data: {
            id: randomUUID(),
            actorUserId,
            targetOrganizationId: organizationId,
            action: "organization.provisioned",
            targetType: "organization",
            targetId: organizationId,
            requestId,
            reason:
              input.actor.kind === "self-service"
                ? "Verified user completed self-service onboarding."
                : "Platform operator provisioned an organization.",
            metadata: {
              foundingUserId,
              firstLocationId: locationId,
              actorKind,
            },
          },
        });
        await transaction.outboxEvent.create({
          data: {
            id: randomUUID(),
            organizationId,
            eventType: "organization.provisioned",
            aggregateType: "organization",
            aggregateId: organizationId,
            payload: {
              organizationId,
              locationId,
              foundingUserId,
              actorKind,
            },
          },
        });

        return {
          organizationId,
          organizationName: normalized.organization.name,
          organizationSlug: normalized.organization.slug,
          locationId,
          locationName: normalized.firstLocation.name,
          membershipId,
          replayed: false,
        };
      },
      {
        isolationLevel: "Serializable",
      },
    );
  } catch (error) {
    if (error instanceof ProvisionOrganizationFailed) {
      throw error;
    }
    if (isUniqueConstraintError(error)) {
      const concurrentReplay = await findReplay(
        input.db,
        actorUserId,
        foundingUserId,
        normalized.idempotencyKey,
        inputHash,
      );
      if (concurrentReplay) {
        return concurrentReplay;
      }
      throw new ProvisionOrganizationFailed("slug_unavailable");
    }
    throw error;
  }
}

async function findReplay(
  db: Pick<PrismaClient, "organizationProvisioningRequest">,
  actorUserId: string,
  foundingUserId: string,
  idempotencyKey: string,
  inputHash: string,
): Promise<ProvisionOrganizationResult | null> {
  const existing = await db.organizationProvisioningRequest.findUnique({
    where: {
      actorUserId_idempotencyKey: {
        actorUserId,
        idempotencyKey,
      },
    },
    include: {
      organization: {
        include: {
          locations: {
            orderBy: { createdAt: "asc" },
            take: 1,
          },
          memberships: {
            where: { userId: foundingUserId },
            orderBy: { createdAt: "asc" },
            take: 1,
          },
        },
      },
    },
  });

  if (!existing) {
    return null;
  }
  if (existing.inputHash !== inputHash) {
    throw new ProvisionOrganizationFailed("idempotency_conflict");
  }

  const location = existing.organization.locations[0];
  const membership = existing.organization.memberships[0];
  if (!location || !membership) {
    throw new Error("A completed provisioning request is missing its bootstrap records.");
  }

  return {
    organizationId: existing.organization.id,
    organizationName: existing.organization.name,
    organizationSlug: existing.organization.slug,
    locationId: location.id,
    locationName: location.name,
    membershipId: membership.id,
    replayed: true,
  };
}

function normalizeInput(input: ProvisionOrganizationInput): Readonly<{
  idempotencyKey: string;
  organization: {
    name: string;
    slug: string;
    defaultCurrency: string;
  };
  firstLocation: {
    name: string;
    code: string;
    timeZone: string;
  };
}> {
  const normalized = {
    idempotencyKey: input.idempotencyKey.trim(),
    organization: {
      name: input.organization.name.trim(),
      slug: input.organization.slug.trim().toLowerCase(),
      defaultCurrency: input.organization.defaultCurrency.trim().toUpperCase(),
    },
    firstLocation: {
      name: input.firstLocation.name.trim(),
      code: input.firstLocation.code.trim().toUpperCase(),
      timeZone: input.firstLocation.timeZone.trim(),
    },
  };

  const valid =
    normalized.idempotencyKey.length >= 8 &&
    normalized.idempotencyKey.length <= 160 &&
    normalized.organization.name.length >= 2 &&
    normalized.organization.name.length <= 180 &&
    /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/.test(normalized.organization.slug) &&
    /^[A-Z]{3}$/.test(normalized.organization.defaultCurrency) &&
    normalized.firstLocation.name.length >= 2 &&
    normalized.firstLocation.name.length <= 180 &&
    /^[A-Z0-9][A-Z0-9_-]{0,31}$/.test(normalized.firstLocation.code) &&
    isValidTimeZone(normalized.firstLocation.timeZone);

  if (!valid) {
    throw new ProvisionOrganizationFailed("invalid_input");
  }

  return normalized;
}

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format();
    return true;
  } catch {
    return false;
  }
}

function hashProvisioningInput(
  input: ReturnType<typeof normalizeInput>,
  foundingUserId: string,
): string {
  return createHash("sha256")
    .update(JSON.stringify({ ...input, foundingUserId }))
    .digest("hex");
}

function isUniqueConstraintError(error: unknown): error is { code: "P2002" } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}
