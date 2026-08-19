import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import {
  decryptSecret,
  encryptSecret,
  getMasterKeyFromEnv,
} from "@/modules/integrations/crypto/secret-cipher";
import type { PaymentsAdapter } from "@/modules/integrations/payments/payments-adapters";
import {
  getConsolePaymentsAdapter,
  StripePaymentsAdapter,
} from "@/modules/integrations/payments/payments-adapters";
import { assertTenantAccess, type TenantContext } from "@/modules/tenancy/policy";

export type PaymentsAdapterDefinition = Readonly<{
  key: string;
  displayName: string;
  description: string;
  secretFields: ReadonlyArray<{
    name: string;
    label: string;
    type: "text" | "password";
    required: boolean;
    placeholder?: string;
  }>;
}>;

export const PAYMENTS_ADAPTER_DEFINITIONS: ReadonlyArray<PaymentsAdapterDefinition> = [
  {
    key: "stripe",
    displayName: "Stripe",
    description:
      "Your own Stripe account. Checkout links accept cards, Apple Pay, Google Pay, Alipay, and WeChat Pay as enabled on the account.",
    secretFields: [
      {
        name: "secretKey",
        label: "Secret Key",
        type: "password",
        required: true,
        placeholder: "sk_live_…",
      },
    ],
  },
];

export function getPaymentsAdapterDefinition(key: string): PaymentsAdapterDefinition | undefined {
  return PAYMENTS_ADAPTER_DEFINITIONS.find((a) => a.key === key);
}

export class PaymentsConnectorOperationFailed extends Error {
  constructor(
    public readonly reason:
      | "invalid_adapter"
      | "invalid_configuration"
      | "encryption_key_missing"
      | "connector_not_found",
  ) {
    super("The payments connector operation could not be completed.");
    this.name = "PaymentsConnectorOperationFailed";
  }
}

/**
 * Resolves the organization's own payment processor (ADR 0016: BYO,
 * org-scoped, intentionally no platform fallback). Null when unconfigured —
 * payment links simply don't appear; nothing in ShopOS requires a processor.
 */
export async function resolvePaymentsAdapter(
  db: PrismaClient,
  organizationId: string,
): Promise<PaymentsAdapter | null> {
  // The shop's own connector always wins, even in dev/test — that is the
  // BYO contract. The console adapter is only the fallback when none is
  // configured outside production.
  const connector = await db.connectorInstance.findFirst({
    where: { organizationId, capability: "payments", status: "active" },
    select: { adapterKey: true, encryptedSecret: true },
  });

  if (!connector) {
    if (process.env.NODE_ENV !== "production") return getConsolePaymentsAdapter();
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

  return instantiatePaymentsAdapter(connector.adapterKey, secret);
}

export function instantiatePaymentsAdapter(
  adapterKey: string,
  secret: Record<string, string>,
): PaymentsAdapter | null {
  switch (adapterKey) {
    case "stripe":
      return secret.secretKey ? new StripePaymentsAdapter({ secretKey: secret.secretKey }) : null;
    default:
      return null;
  }
}

export type PaymentsConnectorSummary = Readonly<{
  id: string;
  adapterKey: string;
  displayName: string;
  status: string;
  updatedAt: Date;
}>;

export async function getOrgPaymentsConnector(
  db: PrismaClient,
  context: TenantContext,
): Promise<PaymentsConnectorSummary | null> {
  assertTenantAccess(context, { organizationId: context.organizationId }, "organizations.manage");

  const connector = await db.connectorInstance.findFirst({
    where: { organizationId: context.organizationId, capability: "payments" },
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

export async function upsertOrgPaymentsConnector(
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

  const adapter = getPaymentsAdapterDefinition(input.adapterKey);
  if (!adapter) throw new PaymentsConnectorOperationFailed("invalid_adapter");
  for (const field of adapter.secretFields) {
    if (field.required && !input.secret[field.name]) {
      throw new PaymentsConnectorOperationFailed("invalid_configuration");
    }
  }

  const masterKey = getMasterKeyFromEnv();
  if (!masterKey) throw new PaymentsConnectorOperationFailed("encryption_key_missing");
  const encryptedSecret = encryptSecret(JSON.stringify(input.secret), masterKey);

  return input.db.$transaction(async (transaction) => {
    await transaction.connectorInstance.updateMany({
      where: {
        organizationId: input.context.organizationId,
        capability: "payments",
        status: "active",
      },
      data: { status: "disabled" },
    });

    const connector = await transaction.connectorInstance.create({
      data: {
        id: randomUUID(),
        organizationId: input.context.organizationId,
        scope: "organization",
        capability: "payments",
        adapterKey: input.adapterKey,
        displayName: input.displayName,
        configuration: {},
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
        action: "payments.connector_configured",
        entityType: "connector",
        entityId: connector.id,
        requestId: input.context.requestId,
        after: { adapterKey: input.adapterKey },
      },
    });

    return { connectorId: connector.id };
  });
}
