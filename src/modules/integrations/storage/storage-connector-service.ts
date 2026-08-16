import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import type { FileStorageProvider } from "@/modules/integrations/contracts";
import {
  decryptSecret,
  encryptSecret,
  getMasterKeyFromEnv,
} from "@/modules/integrations/crypto/secret-cipher";
import { getStorageAdapterDefinition } from "@/modules/integrations/storage/adapters/storage-adapter-types";
import {
  AzureBlobStorageProvider,
  LocalStorageProvider,
  S3StorageProvider,
} from "@/modules/integrations/storage/adapters/storage-providers";
import {
  assertPlatformPermission,
  revalidatePlatformGrant,
  type PlatformContext,
} from "@/modules/platform/authorization";

export type StorageConnectorFailedReason =
  "invalid_adapter" | "invalid_configuration" | "encryption_key_missing" | "connector_not_found";

export class StorageConnectorOperationFailed extends Error {
  constructor(public readonly reason: StorageConnectorFailedReason) {
    super("The storage connector operation could not be completed.");
    this.name = "StorageConnectorOperationFailed";
  }
}

export type StorageConnectorSummary = Readonly<{
  id: string;
  adapterKey: string;
  displayName: string;
  configuration: Record<string, unknown>;
  hasSecret: boolean;
  status: string;
  updatedAt: Date;
}>;

export async function getPlatformStorageConnector(
  db: PrismaClient,
  context: PlatformContext,
): Promise<StorageConnectorSummary | null> {
  assertPlatformPermission(context, "platform.connectors.manage");

  const connector = await db.connectorInstance.findFirst({
    where: { scope: "platform", capability: "file_storage" },
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

export async function upsertPlatformStorageConnector(
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

  const adapter = getStorageAdapterDefinition(input.adapterKey);
  if (!adapter) throw new StorageConnectorOperationFailed("invalid_adapter");

  for (const field of adapter.configFields) {
    if (field.required && !input.configuration[field.name]) {
      throw new StorageConnectorOperationFailed("invalid_configuration");
    }
  }
  for (const field of adapter.secretFields) {
    if (field.required && !input.secret[field.name]) {
      throw new StorageConnectorOperationFailed("invalid_configuration");
    }
  }

  // Preset endpoint templates use <PLACEHOLDER> segments; reject unresolved ones
  // rather than storing an endpoint that can never connect.
  const endpoint = input.configuration.endpoint ? String(input.configuration.endpoint) : "";
  if (/[<>]/.test(endpoint)) {
    throw new StorageConnectorOperationFailed("invalid_configuration");
  }

  const masterKey = getMasterKeyFromEnv();
  const encryptedSecret =
    adapter.secretFields.length > 0
      ? (() => {
          if (!masterKey) throw new StorageConnectorOperationFailed("encryption_key_missing");
          return encryptSecret(JSON.stringify(input.secret), masterKey);
        })()
      : null;

  return input.db.$transaction(async (transaction) => {
    await transaction.connectorInstance.updateMany({
      where: { scope: "platform", capability: "file_storage", status: "active" },
      data: { status: "disabled" },
    });

    const connector = await transaction.connectorInstance.create({
      data: {
        id: randomUUID(),
        scope: "platform",
        capability: "file_storage",
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
        action: "platform.connector.storage_configured",
        targetType: "connector",
        targetId: connector.id,
        requestId: input.context.requestId,
        metadata: { adapterKey: input.adapterKey },
      },
    });

    return { connectorId: connector.id };
  });
}

// ─── Resolution ────────────────────────────────────────────────────────────

let cachedProvider: FileStorageProvider | undefined;
let cacheKey: string | undefined;

export function invalidateStorageCache(): void {
  cachedProvider = undefined;
  cacheKey = undefined;
}

/**
 * Resolves the active file storage provider from the database.
 * Returns null if no storage connector is configured (feature unavailable).
 */
export async function resolveStorageProvider(
  db: PrismaClient,
): Promise<FileStorageProvider | null> {
  const connector = await db.connectorInstance.findFirst({
    where: { scope: "platform", capability: "file_storage", status: "active" },
    select: {
      id: true,
      adapterKey: true,
      configuration: true,
      encryptedSecret: true,
      updatedAt: true,
    },
  });

  if (!connector) return null;

  const newCacheKey = `${connector.id}:${connector.updatedAt.toISOString()}`;
  if (cachedProvider && cacheKey === newCacheKey) return cachedProvider;

  const provider = instantiateStorageAdapter(
    connector.adapterKey,
    connector.configuration,
    connector.encryptedSecret,
  );

  if (provider) {
    cachedProvider = provider;
    cacheKey = newCacheKey;
    return provider;
  }

  return null;
}

function instantiateStorageAdapter(
  adapterKey: string,
  configuration: unknown,
  encryptedSecret: string | null,
): FileStorageProvider | null {
  const config = (configuration ?? {}) as Record<string, unknown>;

  switch (adapterKey) {
    case "s3": {
      const masterKey = getMasterKeyFromEnv();
      if (!masterKey || !encryptedSecret) return null;
      let secret: { accessKeyId: string; secretAccessKey: string };
      try {
        secret = JSON.parse(decryptSecret(encryptedSecret, masterKey));
      } catch {
        return null;
      }
      const bucket = String(config.bucket ?? "");
      if (!bucket || !secret.accessKeyId) return null;
      const region = config.region ? String(config.region) : undefined;
      const endpoint = config.endpoint ? String(config.endpoint) : undefined;
      return new S3StorageProvider(
        {
          bucket,
          ...(region ? { region } : {}),
          ...(endpoint ? { endpoint } : {}),
          forcePathStyle: config.forcePathStyle === true || config.forcePathStyle === "true",
        },
        { accessKeyId: secret.accessKeyId, secretAccessKey: secret.secretAccessKey ?? "" },
      );
    }

    case "azure-blob": {
      const masterKey = getMasterKeyFromEnv();
      if (!masterKey || !encryptedSecret) return null;
      let secret: { accountKey: string };
      try {
        secret = JSON.parse(decryptSecret(encryptedSecret, masterKey));
      } catch {
        return null;
      }
      const accountName = String(config.accountName ?? "");
      const container = String(config.container ?? "");
      if (!accountName || !container || !secret.accountKey) return null;
      const endpointSuffix = config.endpointSuffix ? String(config.endpointSuffix) : undefined;
      return new AzureBlobStorageProvider(
        {
          accountName,
          container,
          ...(endpointSuffix ? { endpointSuffix } : {}),
        },
        { accountKey: secret.accountKey },
      );
    }

    case "local": {
      const basePath = String(config.basePath ?? "");
      if (!basePath) return null;
      return new LocalStorageProvider({ basePath });
    }

    default:
      return null;
  }
}
