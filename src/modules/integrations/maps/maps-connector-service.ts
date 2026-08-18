import type { PrismaClient } from "@/generated/prisma/client";
import {
  decryptSecret,
  encryptSecret,
  getMasterKeyFromEnv,
} from "@/modules/integrations/crypto/secret-cipher";
import type { MapsAdapter } from "@/modules/integrations/maps/maps-adapters";
import {
  AwsLocationAdapter,
  AzureMapsAdapter,
  GoogleMapsAdapter,
  MapboxAdapter,
} from "@/modules/integrations/maps/maps-adapters";
import { getConsoleMapsAdapter } from "@/modules/integrations/maps/maps-adapters";

export type MapsAdapterDefinition = Readonly<{
  key: string;
  displayName: string;
  description: string;
  configFields: ReadonlyArray<{
    name: string;
    label: string;
    type: "text";
    required: boolean;
    placeholder?: string;
  }>;
  secretFields: ReadonlyArray<{
    name: string;
    label: string;
    type: "text" | "password";
    required: boolean;
    placeholder?: string;
  }>;
}>;

export const MAPS_ADAPTER_DEFINITIONS: ReadonlyArray<MapsAdapterDefinition> = [
  {
    key: "google",
    displayName: "Google Maps Platform",
    description:
      "Geocoding API + Directions API. Enable both on the project and paste the API key.",
    configFields: [],
    secretFields: [{ name: "apiKey", label: "API Key", type: "password", required: true }],
  },
  {
    key: "azure",
    displayName: "Azure Maps",
    description: "Fuzzy Search + Route from an Azure Maps account (Gen 2/S1 key).",
    configFields: [],
    secretFields: [
      {
        name: "subscriptionKey",
        label: "Primary Subscription Key",
        type: "password",
        required: true,
      },
    ],
  },
  {
    key: "mapbox",
    displayName: "Mapbox",
    description: "Geocoding + Directions v5 using a public access token.",
    configFields: [],
    secretFields: [
      { name: "accessToken", label: "Access Token", type: "password", required: true },
    ],
  },
  {
    key: "aws",
    displayName: "AWS Location Service",
    description:
      "Place Index + Route Calculator resources in your AWS account (SigV4 keys with geo:SearchPlaceIndexForText and geo:CalculateRoute permissions).",
    configFields: [
      { name: "region", label: "Region", type: "text", required: true, placeholder: "us-east-1" },
      {
        name: "placeIndexName",
        label: "Place Index Name",
        type: "text",
        required: true,
        placeholder: "my-place-index",
      },
      {
        name: "routeCalculatorName",
        label: "Route Calculator Name",
        type: "text",
        required: true,
        placeholder: "my-calculator",
      },
    ],
    secretFields: [
      { name: "accessKeyId", label: "Access Key ID", type: "text", required: true },
      { name: "secretAccessKey", label: "Secret Access Key", type: "password", required: true },
    ],
  },
];

export function getMapsAdapterDefinition(key: string): MapsAdapterDefinition | undefined {
  return MAPS_ADAPTER_DEFINITIONS.find((a) => a.key === key);
}

/**
 * Resolves the active maps adapter (ADR 0008): org-scoped connector first,
 * then platform-scoped, then the dev/test console adapter. Null in production
 * when unconfigured — geocoding and ETA are simply absent, never blocking.
 */
export async function resolveMapsAdapter(
  db: PrismaClient,
  organizationId: string,
): Promise<MapsAdapter | null> {
  if (process.env.NODE_ENV === "test") {
    return getConsoleMapsAdapter();
  }

  const connector =
    (await db.connectorInstance.findFirst({
      where: { organizationId, capability: "maps", status: "active" },
      select: { adapterKey: true, configuration: true, encryptedSecret: true },
    })) ??
    (await db.connectorInstance.findFirst({
      where: { scope: "platform", capability: "maps", status: "active" },
      select: { adapterKey: true, configuration: true, encryptedSecret: true },
    }));

  if (!connector) {
    if (process.env.NODE_ENV !== "production") return getConsoleMapsAdapter();
    return null;
  }

  const masterKey = getMasterKeyFromEnv();
  if (!masterKey || !connector.encryptedSecret) return null;
  let secret: Record<string, string>;
  try {
    secret = JSON.parse(decryptSecret(connector.encryptedSecret, masterKey));
  } catch {
    return null;
  }
  const config = (connector.configuration ?? {}) as Record<string, unknown>;

  return instantiateMapsAdapter(connector.adapterKey, config, secret);
}

export function instantiateMapsAdapter(
  adapterKey: string,
  config: Record<string, unknown>,
  secret: Record<string, string>,
): MapsAdapter | null {
  const str = (key: string) => String(config[key] ?? "");

  switch (adapterKey) {
    case "google":
      return secret.apiKey ? new GoogleMapsAdapter({ apiKey: secret.apiKey }) : null;
    case "azure":
      return secret.subscriptionKey
        ? new AzureMapsAdapter({ subscriptionKey: secret.subscriptionKey })
        : null;
    case "mapbox":
      return secret.accessToken ? new MapboxAdapter({ accessToken: secret.accessToken }) : null;
    case "aws":
      if (!secret.accessKeyId || !secret.secretAccessKey) return null;
      if (!str("region") || !str("placeIndexName") || !str("routeCalculatorName")) return null;
      return new AwsLocationAdapter(
        {
          region: str("region"),
          placeIndexName: str("placeIndexName"),
          routeCalculatorName: str("routeCalculatorName"),
        },
        { accessKeyId: secret.accessKeyId, secretAccessKey: secret.secretAccessKey },
      );
    default:
      return null;
  }
}

import { randomUUID } from "node:crypto";
import {
  assertPlatformPermission,
  revalidatePlatformGrant,
  type PlatformContext,
} from "@/modules/platform/authorization";

export type MapsConnectorFailedReason =
  "invalid_adapter" | "invalid_configuration" | "encryption_key_missing" | "connector_not_found";

export class MapsConnectorOperationFailed extends Error {
  constructor(public readonly reason: MapsConnectorFailedReason) {
    super("The maps connector operation could not be completed.");
    this.name = "MapsConnectorOperationFailed";
  }
}

export type MapsConnectorSummary = Readonly<{
  id: string;
  adapterKey: string;
  displayName: string;
  status: string;
  updatedAt: Date;
}>;

export async function getPlatformMapsConnector(
  db: PrismaClient,
  context: PlatformContext,
): Promise<MapsConnectorSummary | null> {
  assertPlatformPermission(context, "platform.connectors.manage");

  const connector = await db.connectorInstance.findFirst({
    where: { scope: "platform", capability: "maps" },
    orderBy: { updatedAt: "desc" },
  });
  if (!connector) return null;

  return {
    id: connector.id,
    adapterKey: connector.adapterKey,
    displayName: connector.displayName,
    status: connector.status,
    updatedAt: connector.updatedAt,
  };
}

export async function upsertPlatformMapsConnector(
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

  const adapter = getMapsAdapterDefinition(input.adapterKey);
  if (!adapter) throw new MapsConnectorOperationFailed("invalid_adapter");

  for (const field of adapter.configFields) {
    if (field.required && !input.configuration[field.name]) {
      throw new MapsConnectorOperationFailed("invalid_configuration");
    }
  }
  for (const field of adapter.secretFields) {
    if (field.required && !input.secret[field.name]) {
      throw new MapsConnectorOperationFailed("invalid_configuration");
    }
  }

  const masterKey = getMasterKeyFromEnv();
  if (!masterKey) throw new MapsConnectorOperationFailed("encryption_key_missing");
  const encryptedSecret = encryptSecret(JSON.stringify(input.secret), masterKey);

  return input.db.$transaction(async (transaction) => {
    await transaction.connectorInstance.updateMany({
      where: { scope: "platform", capability: "maps", status: "active" },
      data: { status: "disabled" },
    });

    const connector = await transaction.connectorInstance.create({
      data: {
        id: randomUUID(),
        scope: "platform",
        capability: "maps",
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
        action: "platform.connector.maps_configured",
        targetType: "connector",
        targetId: connector.id,
        requestId: input.context.requestId,
        metadata: { adapterKey: input.adapterKey },
      },
    });

    return { connectorId: connector.id };
  });
}
