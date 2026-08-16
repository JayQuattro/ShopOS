import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import { assertTenantAccess, type TenantContext } from "@/modules/tenancy/policy";
import { encryptSecret, getMasterKeyFromEnv } from "@/modules/integrations/crypto/secret-cipher";
import { getAdapterDefinition } from "@/modules/integrations/email/adapters/adapter-types";
import { invalidateEmailDeliveryCache } from "@/modules/integrations/email/email-delivery-resolver";

export type OrgConnectorFailedReason =
  | "invalid_adapter"
  | "invalid_configuration"
  | "encryption_key_missing"
  | "connector_not_found"
  | "entitlement_not_granted";

export class OrgConnectorOperationFailed extends Error {
  constructor(public readonly reason: OrgConnectorFailedReason) {
    super("The organization connector operation could not be completed.");
    this.name = "OrgConnectorOperationFailed";
  }
}

export type OrgEmailConnectorSummary = Readonly<{
  id: string;
  adapterKey: string;
  displayName: string;
  configuration: Record<string, unknown>;
  hasSecret: boolean;
  status: string;
  updatedAt: Date;
}>;

/**
 * Checks whether the organization has the `integrations.custom` entitlement
 * enabled, which is required for org-scoped connector configuration.
 */
async function assertOrgConnectorEntitlement(
  db: PrismaClient,
  organizationId: string,
): Promise<void> {
  const entitlement = await db.organizationEntitlement.findFirst({
    where: { organizationId, key: "integrations.custom", enabled: true },
    select: { id: true },
  });
  if (!entitlement) {
    throw new OrgConnectorOperationFailed("entitlement_not_granted");
  }
}

export async function getOrgEmailConnector(
  db: PrismaClient,
  context: TenantContext,
): Promise<OrgEmailConnectorSummary | null> {
  assertTenantAccess(context, { organizationId: context.organizationId }, "organizations.manage");

  const connector = await db.connectorInstance.findFirst({
    where: {
      organizationId: context.organizationId,
      capability: "email_delivery",
    },
    orderBy: { updatedAt: "desc" },
  });

  if (!connector) return null;

  return {
    id: connector.id,
    adapterKey: connector.adapterKey,
    displayName: connector.displayName,
    configuration: (connector.configuration ?? {}) as Record<string, unknown>,
    hasSecret: connector.encryptedSecret !== null,
    status: connector.status,
    updatedAt: connector.updatedAt,
  };
}

export async function upsertOrgEmailConnector(
  input: Readonly<{
    db: PrismaClient;
    context: TenantContext;
    adapterKey: string;
    displayName: string;
    configuration: Record<string, unknown>;
    secret: Record<string, string>;
  }>,
): Promise<Readonly<{ connectorId: string }>> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "organizations.manage",
  );
  await assertOrgConnectorEntitlement(input.db, input.context.organizationId);

  const adapter = getAdapterDefinition(input.adapterKey);
  if (!adapter) throw new OrgConnectorOperationFailed("invalid_adapter");

  // Validate required fields.
  for (const field of adapter.configFields) {
    if (field.required && !input.configuration[field.name]) {
      throw new OrgConnectorOperationFailed("invalid_configuration");
    }
  }
  for (const field of adapter.secretFields) {
    if (field.required && !input.secret[field.name]) {
      throw new OrgConnectorOperationFailed("invalid_configuration");
    }
  }

  const masterKey = getMasterKeyFromEnv();
  if (!masterKey) throw new OrgConnectorOperationFailed("encryption_key_missing");

  const encryptedSecret = encryptSecret(JSON.stringify(input.secret), masterKey);

  const result = await input.db.$transaction(async (transaction) => {
    await transaction.connectorInstance.updateMany({
      where: {
        organizationId: input.context.organizationId,
        capability: "email_delivery",
        status: "active",
      },
      data: { status: "disabled" },
    });

    const connector = await transaction.connectorInstance.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        scope: "organization",
        capability: "email_delivery",
        adapterKey: input.adapterKey,
        displayName: input.displayName,
        configuration: JSON.parse(JSON.stringify(input.configuration)),
        encryptedSecret,
        status: "active",
        createdByUserId: input.context.actorId,
      },
    });

    await transaction.auditEvent.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        actorUserId: input.context.actorId,
        action: "integrations.connector_configured",
        entityType: "connector",
        entityId: connector.id,
        requestId: input.context.requestId,
        after: { adapterKey: input.adapterKey, capability: "email_delivery" },
      },
    });

    return { connectorId: connector.id };
  });

  invalidateEmailDeliveryCache();
  return result;
}

export async function deleteOrgEmailConnector(
  input: Readonly<{ db: PrismaClient; context: TenantContext }>,
): Promise<void> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "organizations.manage",
  );

  const deleted = await input.db.connectorInstance.deleteMany({
    where: {
      organizationId: input.context.organizationId,
      capability: "email_delivery",
    },
  });
  if (deleted.count === 0) {
    throw new OrgConnectorOperationFailed("connector_not_found");
  }

  await input.db.auditEvent.create({
    data: {
      id: randomUUID(),
      organizationId: input.context.organizationId,
      actorUserId: input.context.actorId,
      action: "integrations.connector_removed",
      entityType: "connector",
      entityId: input.context.organizationId,
      requestId: input.context.requestId,
    },
  });

  invalidateEmailDeliveryCache();
}
