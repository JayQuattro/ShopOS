import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import { assertTenantAccess, type TenantContext } from "@/modules/tenancy/policy";
import { encryptSecret, getMasterKeyFromEnv } from "@/modules/integrations/crypto/secret-cipher";
import { getAdapterDefinition } from "@/modules/integrations/email/adapters/adapter-types";
import type { GenericEmailSender } from "@/modules/integrations/email/generic-email-sender";
import {
  instantiateAdapter,
  invalidateEmailDeliveryCache,
} from "@/modules/integrations/email/email-delivery-resolver";
import { getConsoleAuthDeliveryProvider } from "@/modules/identity/delivery/console-auth-delivery-provider";

export type OrgConnectorFailedReason =
  | "invalid_adapter"
  | "invalid_configuration"
  | "encryption_key_missing"
  | "connector_not_found"
  | "invalid_recipient"
  | "email_not_configured"
  | "send_failed";

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

/**
 * Resolves the provider a real send would use right now: the org connector,
 * then the platform connector (ADR 0008), with the console adapter standing in
 * for unconfigured development environments. Null in production when nothing
 * is configured.
 */
async function resolveEffectiveEmailSender(
  db: PrismaClient,
  organizationId: string,
): Promise<GenericEmailSender | null> {
  if (process.env.NODE_ENV === "test") {
    return getConsoleAuthDeliveryProvider();
  }

  const connector =
    (await db.connectorInstance.findFirst({
      where: { organizationId, capability: "email_delivery", status: "active" },
      select: { adapterKey: true, configuration: true, encryptedSecret: true },
    })) ??
    (await db.connectorInstance.findFirst({
      where: { scope: "platform", capability: "email_delivery", status: "active" },
      select: { adapterKey: true, configuration: true, encryptedSecret: true },
    }));

  const provider = connector
    ? instantiateAdapter(connector.adapterKey, connector.configuration, connector.encryptedSecret)
    : null;
  // Every email adapter implements both AuthDeliveryProvider and
  // GenericEmailSender; narrow at runtime so a future adapter that only
  // handles auth mail can't silently break test sends.
  if (provider && typeof (provider as { sendRaw?: unknown }).sendRaw === "function") {
    return provider as unknown as GenericEmailSender;
  }

  return process.env.NODE_ENV !== "production" ? getConsoleAuthDeliveryProvider() : null;
}

export type EmailTestSendResult = Readonly<{ adapterKey: string }>;

/**
 * Sends one real test message through the provider this organization's email
 * currently resolves to, so "save" can be followed by proof it works.
 */
export async function sendOrgEmailTestMessage(
  input: Readonly<{ db: PrismaClient; context: TenantContext; to: string }>,
): Promise<EmailTestSendResult> {
  assertTenantAccess(
    input.context,
    { organizationId: input.context.organizationId },
    "organizations.manage",
  );

  const to = input.to.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) || to.length > 254) {
    throw new OrgConnectorOperationFailed("invalid_recipient");
  }

  const sender = await resolveEffectiveEmailSender(input.db, input.context.organizationId);
  if (!sender || sender.key === "none") {
    throw new OrgConnectorOperationFailed("email_not_configured");
  }

  const organization = await input.db.organization.findUnique({
    where: { id: input.context.organizationId },
    select: { name: true },
  });

  try {
    await sender.sendRaw({
      organizationId: input.context.organizationId,
      to,
      subject: "ShopOS test email",
      text:
        `This is a test message from ${organization?.name ?? "your shop"}, sent through the ` +
        `"${sender.key}" email connector. If you are reading it, email delivery is working.`,
    });
  } catch {
    throw new OrgConnectorOperationFailed("send_failed");
  }

  return { adapterKey: sender.key };
}
