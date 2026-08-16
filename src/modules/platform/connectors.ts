import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import {
  encryptSecret,
  getMasterKeyFromEnv,
  SecretCipherError,
} from "@/modules/integrations/crypto/secret-cipher";
import {
  EMAIL_ADAPTER_DEFINITIONS,
  getAdapterDefinition,
} from "@/modules/integrations/email/adapters/adapter-types";
import { invalidateEmailDeliveryCache } from "@/modules/integrations/email/email-delivery-resolver";
import {
  assertPlatformPermission,
  revalidatePlatformGrant,
  type PlatformContext,
} from "./authorization";

export type ConnectorFailedReason =
  "invalid_adapter" | "invalid_configuration" | "encryption_key_missing" | "connector_not_found";

export class ConnectorOperationFailed extends Error {
  constructor(public readonly reason: ConnectorFailedReason) {
    super("The connector operation could not be completed.");
    this.name = "ConnectorOperationFailed";
  }
}

export type PlatformEmailConnectorSummary = Readonly<{
  id: string;
  adapterKey: string;
  displayName: string;
  configuration: Record<string, unknown>;
  hasSecret: boolean;
  status: string;
  lastHealthCheckAt: Date | null;
  lastHealthStatus: string | null;
  updatedAt: Date;
}>;

export async function getPlatformEmailConnector(
  db: PrismaClient,
  context: PlatformContext,
): Promise<PlatformEmailConnectorSummary | null> {
  assertPlatformPermission(context, "platform.connectors.manage");

  const connector = await db.connectorInstance.findFirst({
    where: { scope: "platform", capability: "email_delivery" },
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
    lastHealthCheckAt: connector.lastHealthCheckAt,
    lastHealthStatus: connector.lastHealthStatus,
    updatedAt: connector.updatedAt,
  };
}

export async function listEmailAdapterDefinitions(
  _db: PrismaClient,
  context: PlatformContext,
): Promise<typeof EMAIL_ADAPTER_DEFINITIONS> {
  assertPlatformPermission(context, "platform.connectors.manage");
  return EMAIL_ADAPTER_DEFINITIONS;
}

export async function upsertPlatformEmailConnector(
  input: Readonly<{
    db: PrismaClient;
    context: PlatformContext;
    adapterKey: string;
    displayName: string;
    configuration: Record<string, unknown>;
    secret: Record<string, string>;
  }>,
): Promise<Readonly<{ connectorId: string }>> {
  assertPlatformPermission(input.context, "platform.connectors.manage");
  await revalidatePlatformGrant(input.db, input.context);

  const adapter = getAdapterDefinition(input.adapterKey);
  if (!adapter) throw new ConnectorOperationFailed("invalid_adapter");

  // Validate required config fields.
  for (const field of adapter.configFields) {
    if (field.required && !input.configuration[field.name]) {
      throw new ConnectorOperationFailed("invalid_configuration");
    }
  }

  // Validate required secret fields.
  for (const field of adapter.secretFields) {
    if (field.required && !input.secret[field.name]) {
      throw new ConnectorOperationFailed("invalid_configuration");
    }
  }

  const masterKey = getMasterKeyFromEnv();
  if (!masterKey) throw new ConnectorOperationFailed("encryption_key_missing");

  const encryptedSecret = encryptSecret(JSON.stringify(input.secret), masterKey);

  return input.db
    .$transaction(async (transaction) => {
      // Deactivate any existing active connector for this capability.
      await transaction.connectorInstance.updateMany({
        where: { scope: "platform", capability: "email_delivery", status: "active" },
        data: { status: "disabled" },
      });

      const connector = await transaction.connectorInstance.create({
        data: {
          id: randomUUID(),
          scope: "platform",
          capability: "email_delivery",
          adapterKey: input.adapterKey,
          displayName: input.displayName,
          configuration: JSON.parse(JSON.stringify(input.configuration)),
          encryptedSecret,
          status: "active",
          createdByUserId: input.context.actorId,
        },
      });

      await transaction.platformAuditEvent.create({
        data: {
          id: randomUUID(),
          actorUserId: input.context.actorId,
          action: "platform.connector.email_configured",
          targetType: "connector",
          targetId: connector.id,
          requestId: input.context.requestId,
          metadata: { adapterKey: input.adapterKey },
        },
      });

      return { connectorId: connector.id };
    })
    .then((result) => {
      invalidateEmailDeliveryCache();
      return result;
    });
}

export async function testPlatformEmailConnector(
  input: Readonly<{ db: PrismaClient; context: PlatformContext }>,
): Promise<Readonly<{ success: boolean; detail: string }>> {
  assertPlatformPermission(input.context, "platform.connectors.manage");
  await revalidatePlatformGrant(input.db, input.context);

  const connector = await input.db.connectorInstance.findFirst({
    where: { scope: "platform", capability: "email_delivery", status: "active" },
  });

  if (!connector) {
    return { success: false, detail: "No active email connector configured." };
  }

  // For now, just verify the record exists and the adapter is recognized.
  // A full connection test (SMTP verify, Resend API check) would instantiate
  // the adapter and call its verify() method.
  const adapter = getAdapterDefinition(connector.adapterKey);
  if (!adapter) {
    return { success: false, detail: `Unknown adapter: ${connector.adapterKey}` };
  }

  // Update health check timestamp.
  await input.db.connectorInstance.update({
    where: { id: connector.id },
    data: {
      lastHealthCheckAt: new Date(),
      lastHealthStatus: "available",
    },
  });

  return { success: true, detail: `${adapter.displayName} connector is configured.` };
}

void SecretCipherError;
