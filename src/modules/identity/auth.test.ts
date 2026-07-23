import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

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
  authModule = await import("@/modules/identity/auth");
});

afterAll(() => {
  vi.unstubAllEnvs();
});

function requirePlugin(id: string) {
  const plugin = authModule.auth.options.plugins?.find((candidate) => candidate.id === id);

  if (!plugin) {
    throw new Error(`Expected Better Auth plugin ${id}`);
  }

  return plugin;
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

    expect(requirePlugin("organization").options).toMatchObject({
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
    expect(requirePlugin("two-factor").options).toMatchObject({
      issuer: "ShopOS",
    });
    expect(requirePlugin("passkey")).toBeDefined();
    expect(requirePlugin("have-i-been-pwned").options).toMatchObject({
      enabled: false,
    });
  });

  it("keeps organization SSO isolated and invitation-only", () => {
    expect(requirePlugin("sso").options).toMatchObject({
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
