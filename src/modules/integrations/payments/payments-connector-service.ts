import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import {
  decryptSecret,
  encryptSecret,
  getMasterKeyFromEnv,
} from "@/modules/integrations/crypto/secret-cipher";
import type { PaymentsAdapter } from "@/modules/integrations/payments/payments-adapters";
import {
  AdyenPaymentsAdapter,
  getConsolePaymentsAdapter,
  MercadoPagoPaymentsAdapter,
  MolliePaymentsAdapter,
  RazorpayPaymentsAdapter,
  SquarePaymentsAdapter,
  StripePaymentsAdapter,
} from "@/modules/integrations/payments/payments-adapters";
import { assertTenantAccess, type TenantContext } from "@/modules/tenancy/policy";

export type PaymentsAdapterDefinition = Readonly<{
  key: string;
  displayName: string;
  description: string;
  /** Live adapters are selectable; planned ones are honest placeholders. */
  status: "live" | "planned";
  configFields: ReadonlyArray<{
    name: string;
    label: string;
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

export const PAYMENTS_ADAPTER_DEFINITIONS: ReadonlyArray<PaymentsAdapterDefinition> = [
  {
    key: "stripe",
    displayName: "Stripe",
    description:
      "Your own Stripe account. Checkout links accept cards, Apple Pay, Google Pay, Alipay, and WeChat Pay as enabled on the account. Automatic payment confirmation via webhook.",
    status: "live",
    configFields: [],
    secretFields: [
      {
        name: "secretKey",
        label: "Secret Key",
        type: "password",
        required: true,
        placeholder: "sk_live_…",
      },
      {
        name: "webhookSigningSecret",
        label: "Webhook Signing Secret",
        type: "password",
        required: false,
        placeholder: "whsec_… (required for automatic confirmation)",
      },
    ],
  },
  {
    key: "square",
    displayName: "Square",
    description:
      "Square Online Checkout payment links — the default for brick-and-mortar shops on Square. Payments confirm manually until Square webhooks land.",
    status: "live",
    configFields: [
      { name: "locationId", label: "Location ID", required: true, placeholder: "LXXXXXXXXXXXX" },
    ],
    secretFields: [
      {
        name: "accessToken",
        label: "Access Token",
        type: "password",
        required: true,
        placeholder: "EAAA…",
      },
    ],
  },
  {
    key: "adyen",
    displayName: "Adyen",
    description:
      "Adyen Pay by Link — cards, wallets, and local methods worldwide from one hosted page. Payments confirm manually until Adyen webhooks land.",
    status: "live",
    configFields: [
      {
        name: "merchantAccount",
        label: "Merchant Account",
        required: true,
        placeholder: "MyShopECOM",
      },
    ],
    secretFields: [
      { name: "apiKey", label: "API Key", type: "password", required: true, placeholder: "AQEy…" },
    ],
  },
  {
    key: "mollie",
    displayName: "Mollie",
    description:
      "Mollie hosted checkout — the European default, with iDEAL, Bancontact, and cards. Payments confirm manually until Mollie webhooks land.",
    status: "live",
    configFields: [{ name: "webhookUrl", label: "Webhook URL (optional)", required: false }],
    secretFields: [
      { name: "apiKey", label: "API Key", type: "password", required: true, placeholder: "live_…" },
    ],
  },
  {
    key: "paypal",
    displayName: "PayPal",
    description: "PayPal + Venmo wallets.",
    status: "planned",
    configFields: [],
    secretFields: [],
  },
  {
    key: "heartland",
    displayName: "Heartland / Global Payments",
    description: "Heartland (Dealer Tender) — common in automotive dealerships and shops.",
    status: "planned",
    configFields: [],
    secretFields: [],
  },
  {
    key: "worldpay",
    displayName: "Worldpay / Fiserv",
    description: "Worldpay hosted checkout.",
    status: "planned",
    configFields: [],
    secretFields: [],
  },
  {
    key: "chase",
    displayName: "Chase Merchant Services",
    description: "Chase (JPMorgan Payments) hosted payment pages.",
    status: "planned",
    configFields: [],
    secretFields: [],
  },
  {
    key: "authorizenet",
    displayName: "Authorize.Net",
    description: "The long-tail US classic with a hosted payment form.",
    status: "planned",
    configFields: [],
    secretFields: [],
  },
  {
    key: "gocardless",
    displayName: "GoCardless",
    description: "Bank debit (ACH/SEPA) — recurring account billing.",
    status: "planned",
    configFields: [],
    secretFields: [],
  },
  {
    key: "elavon",
    displayName: "Elavon / Converge",
    description: "Elavon hosted checkout.",
    status: "planned",
    configFields: [],
    secretFields: [],
  },
  {
    key: "moneris",
    displayName: "Moneris",
    description:
      "Canada's default processor — two-step Checkout ticket flow; up next for a live adapter.",
    status: "planned",
    configFields: [],
    secretFields: [],
  },
  {
    key: "cielo",
    displayName: "Cielo",
    description: "Brazil's card giant.",
    status: "planned",
    configFields: [],
    secretFields: [],
  },
  {
    key: "pagbank",
    displayName: "PagBank / PagSeguro",
    description: "Brazil — cards and PIX from the PagSeguro ecosystem.",
    status: "planned",
    configFields: [],
    secretFields: [],
  },
  {
    key: "stone",
    displayName: "Stone",
    description: "Brazil — cards and PIX.",
    status: "planned",
    configFields: [],
    secretFields: [],
  },
  {
    key: "clip",
    displayName: "Clip",
    description: "Mexico — the Square of Mexico; cards, SPEI, OXXO.",
    status: "planned",
    configFields: [],
    secretFields: [],
  },
  {
    key: "transbank",
    displayName: "Transbank Webpay",
    description: "Chile's dominant processor (Webpay Plus).",
    status: "planned",
    configFields: [],
    secretFields: [],
  },
  {
    key: "dlocal",
    displayName: "dLocal",
    description: "Pan-regional LatAm PSP — one integration, many rails.",
    status: "planned",
    configFields: [],
    secretFields: [],
  },
  {
    key: "kushki",
    displayName: "Kushki",
    description: "LatAm PSP — local rails across the Andean markets.",
    status: "planned",
    configFields: [],
    secretFields: [],
  },
  {
    key: "getnet",
    displayName: "Getnet",
    description: "Brazil (Santander) — cards and PIX.",
    status: "planned",
    configFields: [],
    secretFields: [],
  },
  {
    key: "mercadopago",
    displayName: "Mercado Pago",
    description:
      "Checkout Pro across Latin America (AR, BR, CL, CO, MX, PE, UY) — cards, PIX, PSE, OXXO, and local rails. Payments confirm manually until Mercado Pago webhooks land.",
    status: "live",
    configFields: [],
    secretFields: [
      {
        name: "accessToken",
        label: "Access Token",
        type: "password",
        required: true,
        placeholder: "APP_USR-…",
      },
    ],
  },
  {
    key: "razorpay",
    displayName: "Razorpay",
    description:
      "Payment links for India — cards, UPI, netbanking, and wallets. Payments confirm manually until Razorpay webhooks land.",
    status: "live",
    configFields: [],
    secretFields: [
      { name: "keyId", label: "Key ID", type: "text", required: true, placeholder: "rzp_live_…" },
      { name: "keySecret", label: "Key Secret", type: "password", required: true },
      {
        name: "webhookSecret",
        label: "Webhook Secret",
        type: "password",
        required: false,
        placeholder: "for automatic confirmation (later)",
      },
    ],
  },
  {
    key: "clover",
    displayName: "Clover (Fiserv)",
    description: "Clover-hosted checkout and terminals.",
    status: "planned",
    configFields: [],
    secretFields: [],
  },
];

export function getPaymentsAdapterDefinition(key: string): PaymentsAdapterDefinition | undefined {
  return PAYMENTS_ADAPTER_DEFINITIONS.find((a) => a.key === key);
}

export class PaymentsConnectorOperationFailed extends Error {
  constructor(
    public readonly reason:
      | "invalid_adapter"
      | "adapter_not_available"
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
    select: { adapterKey: true, configuration: true, encryptedSecret: true },
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

  const config = (connector.configuration ?? {}) as Record<string, unknown>;
  return instantiatePaymentsAdapter(connector.adapterKey, config, secret);
}

/**
 * Internal: the organization's decrypted processor secrets, used only after
 * a webhook's organization has been resolved from the endpoint path. Never
 * exposed through transport responses.
 */
export async function resolveOrgPaymentsSecrets(
  db: PrismaClient,
  organizationId: string,
): Promise<Readonly<{ adapterKey: string; secret: Record<string, string> }> | null> {
  const connector = await db.connectorInstance.findFirst({
    where: { organizationId, capability: "payments", status: "active" },
    select: { adapterKey: true, configuration: true, encryptedSecret: true },
  });
  if (!connector) return null;

  const masterKey = getMasterKeyFromEnv();
  if (!masterKey || !connector.encryptedSecret) return null;
  try {
    return {
      adapterKey: connector.adapterKey,
      secret: JSON.parse(decryptSecret(connector.encryptedSecret, masterKey)),
    };
  } catch {
    return null;
  }
}

export function instantiatePaymentsAdapter(
  adapterKey: string,
  config: Record<string, unknown>,
  secret: Record<string, string>,
): PaymentsAdapter | null {
  switch (adapterKey) {
    case "stripe":
      return secret.secretKey ? new StripePaymentsAdapter({ secretKey: secret.secretKey }) : null;
    case "square": {
      const locationId = String(config.locationId ?? "");
      return secret.accessToken && locationId
        ? new SquarePaymentsAdapter({ locationId }, { accessToken: secret.accessToken })
        : null;
    }
    case "adyen": {
      const merchantAccount = String(config.merchantAccount ?? "");
      return secret.apiKey && merchantAccount
        ? new AdyenPaymentsAdapter({ apiKey: secret.apiKey }, { merchantAccount })
        : null;
    }
    case "mercadopago":
      return secret.accessToken
        ? new MercadoPagoPaymentsAdapter({ accessToken: secret.accessToken })
        : null;
    case "razorpay":
      return secret.keyId && secret.keySecret
        ? new RazorpayPaymentsAdapter({ keyId: secret.keyId, keySecret: secret.keySecret })
        : null;
    case "mollie": {
      const webhookUrl = config.webhookUrl ? String(config.webhookUrl) : undefined;
      return secret.apiKey
        ? new MolliePaymentsAdapter({ apiKey: secret.apiKey }, webhookUrl ? { webhookUrl } : {})
        : null;
    }
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
    configuration?: Record<string, unknown>;
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
  if (adapter.status !== "live")
    throw new PaymentsConnectorOperationFailed("adapter_not_available");
  for (const field of adapter.configFields) {
    if (field.required && !input.configuration?.[field.name]) {
      throw new PaymentsConnectorOperationFailed("invalid_configuration");
    }
  }
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
        configuration: JSON.parse(JSON.stringify(input.configuration ?? {})),
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
