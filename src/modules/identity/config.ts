import { z } from "zod";

export type AuthDeliveryProviderKey = "console" | "none";

export type AuthConfig = Readonly<{
  secret: string;
  baseURL: string;
  trustedOrigins: ReadonlyArray<string>;
  isProduction: boolean;
  session: Readonly<{
    expiresIn: number;
    updateAge: number;
  }>;
  cookieCache: Readonly<{
    enabled: boolean;
    maxAge: number;
  }>;
  deliveryProviderKey: AuthDeliveryProviderKey;
}>;

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = SECONDS_PER_MINUTE * 60;
const SECONDS_PER_DAY = SECONDS_PER_HOUR * 24;
const SEVEN_DAYS = SECONDS_PER_DAY * 7;
const ONE_DAY = SECONDS_PER_DAY;

const deliveryProviderSchema = z.enum(["console", "none"]).default("none");

const envSchema = z
  .object({
    NODE_ENV: z.string().default("development"),
    BETTER_AUTH_SECRET: z.string().min(1),
    BETTER_AUTH_URL: z.string().url().optional(),
    APP_URL: z.string().url().optional(),
    AUTH_EMAIL_DELIVERY: deliveryProviderSchema,
  })
  .transform((values) => {
    const baseURL = values.BETTER_AUTH_URL ?? values.APP_URL;
    if (!baseURL) {
      throw new Error(
        "BETTER_AUTH_URL (or APP_URL) is required for Better Auth routing and trusted origins.",
      );
    }
    return { ...values, baseURL };
  });

/**
 * Resolves and validates the auth configuration from the process environment.
 *
 * Better Auth reads the secret and base URL at construction time, so this module
 * must be imported after any environment stubbing. Tests follow the established
 * pattern of stubbing env vars and then dynamically importing `@/modules/identity/auth`.
 */
export function resolveAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const parsed = envSchema.parse(env);
  const isProduction = parsed.NODE_ENV === "production";

  if (isProduction && parsed.BETTER_AUTH_SECRET.length < 32) {
    throw new Error(
      "BETTER_AUTH_SECRET must be at least 32 characters in production to protect sessions.",
    );
  }

  const deliveryProviderKey = parsed.AUTH_EMAIL_DELIVERY;

  return {
    secret: parsed.BETTER_AUTH_SECRET,
    baseURL: parsed.baseURL,
    trustedOrigins: [parsed.baseURL],
    isProduction,
    session: {
      expiresIn: SEVEN_DAYS,
      updateAge: ONE_DAY,
    },
    cookieCache: {
      enabled: true,
      maxAge: 5 * SECONDS_PER_MINUTE,
    },
    deliveryProviderKey: isProduction ? "none" : deliveryProviderKey,
  };
}

let cachedConfig: AuthConfig | undefined;

/**
 * Returns the resolved auth configuration, caching the first successful read so
 * that the Better Auth instance and route handlers share a single source of truth.
 */
export function getAuthConfig(): AuthConfig {
  if (!cachedConfig) {
    cachedConfig = resolveAuthConfig();
  }
  return cachedConfig;
}

/**
 * Test-only escape hatch: clears the cached configuration so a subsequent
 * `getAuthConfig()` call re-reads the (possibly stubbed) environment.
 */
export function resetAuthConfigCache(): void {
  cachedConfig = undefined;
}
