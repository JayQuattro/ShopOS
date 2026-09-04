import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import {
  decryptSecret,
  encryptSecret,
  getMasterKeyFromEnv,
} from "@/modules/integrations/crypto/secret-cipher";
import {
  NhtsaVpicAdapter,
  type VehicleIdentificationAdapter,
} from "@/modules/integrations/vehicle-id/vehicle-id-adapters";
import { getConsoleVehicleIdentificationAdapter } from "@/modules/integrations/vehicle-id/vehicle-id-adapters";
import {
  assertPlatformPermission,
  revalidatePlatformGrant,
  type PlatformContext,
} from "@/modules/platform/authorization";

export const VEHICLE_ID_CAPABILITY = "vehicle_identification";

export type VehicleIdAdapterDefinition = Readonly<{
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

export const VEHICLE_ID_ADAPTER_DEFINITIONS: ReadonlyArray<VehicleIdAdapterDefinition> = [
  {
    key: "nhtsa-vpic",
    displayName: "NHTSA vPIC (free, no key)",
    description:
      "The US National Highway Traffic Safety Administration's public VIN decoder. No account or credentials required — this is also the built-in default.",
    configFields: [],
    secretFields: [],
  },
  {
    key: "disabled",
    displayName: "Disabled (manual entry only)",
    description:
      "Turn VIN decoding off. Vehicles are entered by hand and nothing is sent to any provider.",
    configFields: [],
    secretFields: [],
  },
];

export function getVehicleIdAdapterDefinition(key: string): VehicleIdAdapterDefinition | undefined {
  return VEHICLE_ID_ADAPTER_DEFINITIONS.find((a) => a.key === key);
}

/**
 * Resolves the active VIN-decoding adapter (ADR 0008): org-scoped connector
 * first, then platform-scoped. Unlike key-bearing capabilities, vPIC is free
 * and keyless, so an unconfigured installation falls back to it instead of
 * null — decoding degrades only when explicitly disabled. The test
 * environment always gets the deterministic console adapter.
 */
export async function resolveVehicleIdAdapter(
  db: PrismaClient,
  organizationId: string,
): Promise<VehicleIdentificationAdapter | null> {
  if (process.env.NODE_ENV === "test") {
    return getConsoleVehicleIdentificationAdapter();
  }

  const connector =
    (await db.connectorInstance.findFirst({
      where: {
        organizationId,
        capability: VEHICLE_ID_CAPABILITY,
        status: "active",
      },
      select: { adapterKey: true, configuration: true, encryptedSecret: true },
    })) ??
    (await db.connectorInstance.findFirst({
      where: { scope: "platform", capability: VEHICLE_ID_CAPABILITY, status: "active" },
      select: { adapterKey: true, configuration: true, encryptedSecret: true },
    }));

  // No explicit configuration: use the keyless public default.
  if (!connector) return new NhtsaVpicAdapter();
  if (connector.adapterKey === "disabled") return null;

  if (!getVehicleIdAdapterDefinition(connector.adapterKey)) return new NhtsaVpicAdapter();

  const masterKey = getMasterKeyFromEnv();
  if (!masterKey || !connector.encryptedSecret) return new NhtsaVpicAdapter();
  let secret: Record<string, string>;
  try {
    secret = JSON.parse(decryptSecret(connector.encryptedSecret, masterKey));
  } catch {
    // Unreadable configuration falls back to the keyless default, not null:
    // a broken rotation should not silently disable decoding.
    return new NhtsaVpicAdapter();
  }
  const config = (connector.configuration ?? {}) as Record<string, unknown>;

  return instantiateVehicleIdAdapter(connector.adapterKey, config, secret);
}

export function instantiateVehicleIdAdapter(
  adapterKey: string,
  _config: Record<string, unknown>,
  _secret: Record<string, string>,
): VehicleIdentificationAdapter | null {
  switch (adapterKey) {
    case "nhtsa-vpic":
      return new NhtsaVpicAdapter();
    case "disabled":
      return null;
    default:
      return null;
  }
}

export type VehicleIdConnectorFailedReason =
  "invalid_adapter" | "invalid_configuration" | "encryption_key_missing" | "connector_not_found";

export class VehicleIdConnectorOperationFailed extends Error {
  constructor(public readonly reason: VehicleIdConnectorFailedReason) {
    super("The vehicle identification connector operation could not be completed.");
    this.name = "VehicleIdConnectorOperationFailed";
  }
}

export type VehicleIdConnectorSummary = Readonly<{
  id: string;
  adapterKey: string;
  displayName: string;
  status: string;
  updatedAt: Date;
}>;

export async function getPlatformVehicleIdConnector(
  db: PrismaClient,
  context: PlatformContext,
): Promise<VehicleIdConnectorSummary | null> {
  assertPlatformPermission(context, "platform.connectors.manage");

  const connector = await db.connectorInstance.findFirst({
    where: { scope: "platform", capability: VEHICLE_ID_CAPABILITY },
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

export async function upsertPlatformVehicleIdConnector(
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

  const adapter = getVehicleIdAdapterDefinition(input.adapterKey);
  if (!adapter) throw new VehicleIdConnectorOperationFailed("invalid_adapter");

  for (const field of adapter.configFields) {
    if (field.required && !input.configuration[field.name]) {
      throw new VehicleIdConnectorOperationFailed("invalid_configuration");
    }
  }
  for (const field of adapter.secretFields) {
    if (field.required && !input.secret[field.name]) {
      throw new VehicleIdConnectorOperationFailed("invalid_configuration");
    }
  }

  const masterKey = getMasterKeyFromEnv();
  if (!masterKey) throw new VehicleIdConnectorOperationFailed("encryption_key_missing");
  const encryptedSecret = encryptSecret(JSON.stringify(input.secret), masterKey);

  return input.db.$transaction(async (transaction) => {
    await transaction.connectorInstance.updateMany({
      where: { scope: "platform", capability: VEHICLE_ID_CAPABILITY, status: "active" },
      data: { status: "disabled" },
    });

    const connector = await transaction.connectorInstance.create({
      data: {
        id: randomUUID(),
        scope: "platform",
        capability: VEHICLE_ID_CAPABILITY,
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
        action: "platform.connector.vehicle_id_configured",
        targetType: "connector",
        targetId: connector.id,
        requestId: input.context.requestId,
        metadata: { adapterKey: input.adapterKey },
      },
    });

    return { connectorId: connector.id };
  });
}
