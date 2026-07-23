import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { resetAuthConfigCache } from "@/modules/identity/config";
import { getConsoleAuthDeliveryProvider } from "@/modules/identity/delivery/console-auth-delivery-provider";

type AuthModule = typeof import("@/modules/identity/auth");

let authModule: AuthModule;

beforeAll(async () => {
  vi.stubEnv(
    "DATABASE_URL",
    "postgresql://shopos:shopos@127.0.0.1:5432/shopos?schema=auth-contract-test",
  );
  vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
  vi.stubEnv("BETTER_AUTH_SECRET", "test-only-better-auth-secret-at-least-32-characters");
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("AUTH_EMAIL_DELIVERY", "console");
  resetAuthConfigCache();
  authModule = await import("@/modules/identity/auth");
});

afterAll(() => {
  vi.unstubAllEnvs();
  resetAuthConfigCache();
});

type PluginWithOptions = { id: string; options: Record<string, unknown> };

function findPlugin(id: string) {
  const plugin = authModule.auth.options.plugins?.find((candidate) => candidate.id === id);

  if (!plugin) {
    throw new Error(`Expected Better Auth plugin ${id}`);
  }

  return plugin;
}

function requirePluginWithOptions(id: string): PluginWithOptions {
  const plugin = findPlugin(id);

  if (!("options" in plugin) || typeof plugin.options !== "object" || plugin.options === null) {
    throw new Error(`Better Auth plugin ${id} did not expose an options object.`);
  }

  return plugin as PluginWithOptions;
}

describe("Better Auth configuration", () => {
  it("reuses the ShopOS identity and organization graph", () => {
    expect(authModule.auth.options.user).toMatchObject({
      modelName: "User",
      fields: {
        name: "displayName",
      },
      deleteUser: {
        enabled: false,
      },
    });
    expect(authModule.auth.options.session?.modelName).toBe("AuthSession");
    expect(authModule.auth.options.account?.modelName).toBe("AuthAccount");
    expect(authModule.auth.options.verification).toMatchObject({
      modelName: "AuthVerification",
      storeIdentifier: "hashed",
    });

    expect(requirePluginWithOptions("organization").options).toMatchObject({
      allowUserToCreateOrganization: false,
      disableOrganizationDeletion: true,
      requireEmailVerificationOnInvitation: true,
      schema: {
        organization: {
          modelName: "Organization",
        },
        member: {
          modelName: "OrganizationMembership",
          fields: {
            role: "authRole",
          },
        },
        invitation: {
          modelName: "OrganizationInvitation",
        },
      },
    });
  });

  it("enables strong credentials without implicit identity linking", () => {
    expect(authModule.auth.options.emailAndPassword).toMatchObject({
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 12,
    });
    expect(authModule.auth.options.account?.accountLinking).toMatchObject({
      enabled: true,
      disableImplicitLinking: true,
    });
    expect(requirePluginWithOptions("two-factor").options).toMatchObject({
      issuer: "ShopOS",
    });
    expect(findPlugin("passkey")).toBeDefined();
    expect(requirePluginWithOptions("have-i-been-pwned").options).toMatchObject({
      enabled: false,
    });
  });

  it("keeps organization SSO isolated and invitation-only", () => {
    expect(requirePluginWithOptions("sso").options).toMatchObject({
      modelName: "OrganizationSsoProvider",
      disableImplicitSignUp: true,
      organizationProvisioning: {
        disabled: true,
      },
      domainVerification: {
        enabled: true,
      },
      saml: {
        enableInResponseToValidation: true,
        allowIdpInitiated: false,
        requireTimestampConditions: true,
      },
    });
  });
});

describe("auth delivery and recovery wiring", () => {
  it("wires email verification, password reset, magic link, email OTP, and 2FA OTP delivery", () => {
    expect(authModule.auth.options.emailVerification).toMatchObject({
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
    });
    expect(typeof authModule.auth.options.emailAndPassword?.sendResetPassword).toBe("function");
    expect(findPlugin("magic-link")).toBeDefined();
    expect(findPlugin("email-otp")).toBeDefined();
    const twoFactorOptions = requirePluginWithOptions("two-factor").options as Record<
      string,
      unknown
    >;
    expect(twoFactorOptions).toMatchObject({
      otpOptions: {
        sendOTP: expect.any(Function),
      },
    });
  });

  it("resolves the console delivery provider in tests", () => {
    expect(authModule.authDeliveryProvider.key).toBe("console");
    expect(authModule.authDeliveryProvider).toBe(getConsoleAuthDeliveryProvider());
  });

  it("enables rate limiting with tightened credential, recovery, and verification rules", () => {
    expect(authModule.auth.options.rateLimit).toMatchObject({
      enabled: true,
    });
    const rules = authModule.auth.options.rateLimit?.customRules ?? {};
    expect(rules["/sign-in/email"]).toMatchObject({ window: 60, max: 5 });
    expect(rules["/reset-password"]).toMatchObject({ window: 60, max: 3 });
    expect(rules["/forget-password"]).toMatchObject({ window: 60, max: 3 });
    expect(rules["/verify-email"]).toMatchObject({ window: 60, max: 5 });
    expect(rules["/magic-link/*"]).toMatchObject({ window: 60, max: 3 });
    expect(rules["/email-otp/*"]).toMatchObject({ window: 60, max: 3 });
    expect(rules["/two-factor/*"]).toMatchObject({ window: 60, max: 5 });
  });

  it("configures trusted origins and bounded cookie caching", () => {
    expect(authModule.auth.options.trustedOrigins).toContain("http://localhost:3000");
    expect(authModule.auth.options.session).toMatchObject({
      cookieCache: {
        enabled: true,
        maxAge: 300,
      },
    });
  });

  it("registers nextCookies as the final plugin so server actions set cookies", () => {
    const plugins = authModule.auth.options.plugins ?? [];
    expect(plugins[plugins.length - 1]?.id).toBe("next-cookies");
  });
});
