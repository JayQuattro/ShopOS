import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import {
  decryptSecret,
  encryptSecret,
  getMasterKeyFromEnv,
} from "@/modules/integrations/crypto/secret-cipher";
import type { VideoAdapter } from "@/modules/integrations/video/video-adapters";
import { getLocalVideoAdapter, MuxVideoAdapter } from "@/modules/integrations/video/video-adapters";
import { assertTenantAccess, type TenantContext } from "@/modules/tenancy/policy";

export type VideoAdapterDefinition = Readonly<{
  key: string;
  displayName: string;
  description: string;
  status: "live" | "planned";
  secretFields: ReadonlyArray<{
    name: string;
    label: string;
    type: "text" | "password";
    required: boolean;
    placeholder?: string;
  }>;
}>;

export const VIDEO_ADAPTER_DEFINITIONS: ReadonlyArray<VideoAdapterDefinition> = [
  {
    key: "mux",
    displayName: "Mux",
    description:
      "Direct uploads with adaptive HLS streaming, thumbnails, and playback APIs. Paste a Mux access token pair.",
    status: "live",
    secretFields: [
      { name: "tokenId", label: "Access Token ID", type: "text", required: true },
      { name: "tokenSecret", label: "Access Token Secret", type: "password", required: true },
    ],
  },
  {
    key: "cloudflare-stream",
    displayName: "Cloudflare Stream",
    description: "Direct uploads + adaptive streaming on Cloudflare's edge.",
    status: "planned",
    secretFields: [],
  },
  {
    key: "api-video",
    displayName: "api.video",
    description: "Video API with player + analytics.",
    status: "planned",
    secretFields: [],
  },
  {
    key: "bunny-stream",
    displayName: "Bunny Stream",
    description: "Cheap, fast video CDN with direct uploads.",
    status: "planned",
    secretFields: [],
  },
];

export class VideoConnectorOperationFailed extends Error {
  constructor(
    public readonly reason:
      | "invalid_adapter"
      | "adapter_not_available"
      | "invalid_configuration"
      | "encryption_key_missing",
  ) {
    super("The video connector operation could not be completed.");
    this.name = "VideoConnectorOperationFailed";
  }
}

/**
 * Resolves the organization's video provider (ADR 0018: BYO like payments,
 * no platform fallback). Dev/test and unconfigured orgs run local mode
 * through the storage connector family — video works with zero setup, and
 * Mux takes over the moment credentials exist.
 */
export async function resolveVideoAdapter(
  db: PrismaClient,
  organizationId: string,
): Promise<VideoAdapter> {
  const connector = await db.connectorInstance.findFirst({
    where: { organizationId, capability: "video", status: "active" },
    select: { adapterKey: true, encryptedSecret: true },
  });

  if (!connector) return getLocalVideoAdapter();

  const masterKey = getMasterKeyFromEnv();
  if (!masterKey || !connector.encryptedSecret) return getLocalVideoAdapter();
  let secret: Record<string, string>;
  try {
    secret = JSON.parse(decryptSecret(connector.encryptedSecret, masterKey));
  } catch {
    return getLocalVideoAdapter();
  }

  if (connector.adapterKey === "mux" && secret.tokenId && secret.tokenSecret) {
    return new MuxVideoAdapter({ tokenId: secret.tokenId, tokenSecret: secret.tokenSecret });
  }
  return getLocalVideoAdapter();
}

export async function upsertOrgVideoConnector(
  input: Readonly<{
    db: PrismaClient;
    context: TenantContext;
    adapterKey: string;
    displayName: string;
    secret: Record<string, string>;
  }>,
): Promise<Readonly<{ connectorId: string }>> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "organizations.manage",
  );

  const adapter = VIDEO_ADAPTER_DEFINITIONS.find((a) => a.key === input.adapterKey);
  if (!adapter) throw new VideoConnectorOperationFailed("invalid_adapter");
  if (adapter.status !== "live") throw new VideoConnectorOperationFailed("adapter_not_available");
  for (const field of adapter.secretFields) {
    if (field.required && !input.secret[field.name]) {
      throw new VideoConnectorOperationFailed("invalid_configuration");
    }
  }

  const masterKey = getMasterKeyFromEnv();
  if (!masterKey) throw new VideoConnectorOperationFailed("encryption_key_missing");

  return input.db.$transaction(async (transaction) => {
    await transaction.connectorInstance.updateMany({
      where: {
        organizationId: input.context.organizationId,
        capability: "video",
        status: "active",
      },
      data: { status: "disabled" },
    });
    const connector = await transaction.connectorInstance.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        scope: "organization",
        capability: "video",
        adapterKey: input.adapterKey,
        displayName: input.displayName,
        configuration: {},
        encryptedSecret: encryptSecret(JSON.stringify(input.secret), masterKey),
        status: "active",
        createdByUserId: input.context.actorId,
      },
      select: { id: true },
    });
    await transaction.auditEvent.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        actorUserId: input.context.actorId,
        action: "video.connector_configured",
        entityType: "connector",
        entityId: connector.id,
        requestId: input.context.requestId,
        after: { adapterKey: input.adapterKey },
      },
    });
    return { connectorId: connector.id };
  });
}
