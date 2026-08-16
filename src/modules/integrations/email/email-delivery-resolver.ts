import type { PrismaClient } from "@/generated/prisma/client";
import type { AuthDeliveryProvider } from "@/modules/identity/delivery/auth-delivery-provider";
import { getConsoleAuthDeliveryProvider } from "@/modules/identity/delivery/console-auth-delivery-provider";
import { getNullAuthDeliveryProvider } from "@/modules/identity/delivery/null-auth-delivery-provider";
import {
  decryptSecret,
  getMasterKeyFromEnv,
  SecretCipherError,
} from "@/modules/integrations/crypto/secret-cipher";
import { ResendAuthDeliveryProvider } from "@/modules/integrations/email/adapters/resend-auth-delivery";
import { SmtpAuthDeliveryProvider } from "@/modules/integrations/email/adapters/smtp-auth-delivery";
import type {
  ResendConfiguration,
  SmtpConfiguration,
  SmtpSecret,
  ResendSecret,
} from "@/modules/integrations/email/adapters/adapter-types";

/**
 * Resolves the active email delivery adapter from the database.
 *
 * Resolution order:
 * 1. Active platform-scoped ConnectorInstance with capability=email_delivery
 * 2. If NODE_ENV is not production: ConsoleAuthDeliveryProvider (dev/test)
 * 3. NullAuthDeliveryProvider (fail safe — never crashes recovery endpoints)
 *
 * The adapter is cached in module scope and invalidated when the connector
 * configuration changes (updateConnector clears the cache).
 */

let cachedProvider: AuthDeliveryProvider | undefined;
let cacheKey: string | undefined;

/**
 * Clears the cached adapter. Called after connector configuration changes
 * so the next send picks up the new settings.
 */
export function invalidateEmailDeliveryCache(): void {
  cachedProvider = undefined;
  cacheKey = undefined;
}

/**
 * Resolves the email delivery provider. Synchronous — uses the cached
 * adapter if available, otherwise returns the dev/test fallback.
 *
 * For the first call in a request, call `refreshEmailDeliveryCache(db)`
 * (async) to populate from the database, then use this synchronous getter.
 */
export function getCachedEmailDeliveryProvider(): AuthDeliveryProvider {
  // In test mode, always use the console adapter singleton (tests expect
  // deterministic behavior and reference the singleton for capture assertions).
  if (process.env.NODE_ENV === "test") {
    return getConsoleAuthDeliveryProvider();
  }

  if (cachedProvider) return cachedProvider;

  // Dev fallback when no DB connector is configured.
  if (process.env.NODE_ENV !== "production") {
    return getConsoleAuthDeliveryProvider();
  }

  return getNullAuthDeliveryProvider();
}

/**
 * Refreshes the email delivery cache from the database.
 * Call this at the start of a request cycle (or after config changes).
 */
export async function refreshEmailDeliveryCache(db: PrismaClient): Promise<AuthDeliveryProvider> {
  // In test mode, skip the DB query — tests use the console adapter.
  if (process.env.NODE_ENV === "test") {
    return getCachedEmailDeliveryProvider();
  }

  const connector = await db.connectorInstance.findFirst({
    where: {
      scope: "platform",
      capability: "email_delivery",
      status: "active",
    },
    select: {
      id: true,
      adapterKey: true,
      configuration: true,
      encryptedSecret: true,
      updatedAt: true,
    },
  });

  // No connector configured → fallback chain.
  if (!connector) {
    invalidateEmailDeliveryCache();
    return getCachedEmailDeliveryProvider();
  }

  // Build a cache key from connector ID + updatedAt to detect changes.
  const newCacheKey = `${connector.id}:${connector.updatedAt.toISOString()}`;

  // Same config, reuse cached adapter.
  if (cachedProvider && cacheKey === newCacheKey) {
    return cachedProvider;
  }

  // Try to instantiate the adapter.
  const provider = instantiateAdapter(
    connector.adapterKey,
    connector.configuration,
    connector.encryptedSecret,
  );

  if (provider) {
    cachedProvider = provider;
    cacheKey = newCacheKey;
    return provider;
  }

  // Adapter instantiation failed (bad config, missing key, etc.) → fallback.
  invalidateEmailDeliveryCache();
  return getCachedEmailDeliveryProvider();
}

function instantiateAdapter(
  adapterKey: string,
  configuration: unknown,
  encryptedSecret: string | null,
): AuthDeliveryProvider | null {
  const masterKey = getMasterKeyFromEnv();
  if (!masterKey || !encryptedSecret) return null;

  let secretJson: string;
  try {
    secretJson = decryptSecret(encryptedSecret, masterKey);
  } catch (error) {
    if (error instanceof SecretCipherError) return null;
    return null;
  }

  const config = (configuration ?? {}) as Record<string, unknown>;

  switch (adapterKey) {
    case "smtp": {
      const smtpConfig: SmtpConfiguration = {
        host: String(config.host ?? ""),
        port: Number(config.port ?? 587),
        secure: Boolean(config.secure ?? false),
        fromAddress: String(config.fromAddress ?? ""),
        ...(config.fromName ? { fromName: String(config.fromName) } : {}),
      };
      const smtpSecret = JSON.parse(secretJson) as SmtpSecret;
      if (!smtpConfig.host || !smtpConfig.fromAddress || !smtpSecret.username) return null;
      return new SmtpAuthDeliveryProvider(smtpConfig, smtpSecret);
    }

    case "resend": {
      const resendConfig: ResendConfiguration = {
        fromAddress: String(config.fromAddress ?? ""),
        ...(config.fromName ? { fromName: String(config.fromName) } : {}),
      };
      const resendSecret = JSON.parse(secretJson) as ResendSecret;
      if (!resendConfig.fromAddress || !resendSecret.apiKey) return null;
      return new ResendAuthDeliveryProvider(resendConfig, resendSecret);
    }

    default:
      return null;
  }
}
