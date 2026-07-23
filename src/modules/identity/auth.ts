import { passkey } from "@better-auth/passkey";
import { prismaAdapter } from "@better-auth/prisma-adapter";
import { sso } from "@better-auth/sso";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { emailOTP, haveIBeenPwned, magicLink, organization, twoFactor } from "better-auth/plugins";

import { db } from "@/db/client";
import { getAuthConfig } from "@/modules/identity/config";
import type {
  AuthDeliveryMessage,
  AuthDeliveryProvider,
} from "@/modules/identity/delivery/auth-delivery-provider";
import { resolveAuthDeliveryProvider } from "@/modules/identity/delivery/resolve-auth-delivery-provider";

const config = getAuthConfig();

const deliveryProvider: AuthDeliveryProvider = resolveAuthDeliveryProvider(
  config.deliveryProviderKey,
);

export const authDeliveryProvider = deliveryProvider;

function deliver(message: AuthDeliveryMessage): void {
  // Fire-and-forget per Better Auth's timing-attack guidance; provider resolves
  // synchronously and must never throw on a real send failure.
  deliveryProvider.send(message);
}

export const auth = betterAuth({
  appName: "ShopOS",
  baseURL: config.baseURL,
  secret: config.secret,
  trustedOrigins: [...config.trustedOrigins],
  database: prismaAdapter(db, {
    provider: "postgresql",
  }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    minPasswordLength: 12,
    sendResetPassword: async ({ user, url }) => {
      deliver({ kind: "password-reset-email", to: user.email, url });
    },
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      deliver({ kind: "verification-email", to: user.email, url });
    },
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
  },
  user: {
    modelName: "User",
    fields: {
      name: "displayName",
    },
    deleteUser: {
      enabled: false,
    },
  },
  session: {
    modelName: "AuthSession",
    expiresIn: config.session.expiresIn,
    updateAge: config.session.updateAge,
    cookieCache: {
      enabled: config.cookieCache.enabled,
      maxAge: config.cookieCache.maxAge,
    },
  },
  account: {
    modelName: "AuthAccount",
    accountLinking: {
      enabled: true,
      disableImplicitLinking: true,
    },
  },
  verification: {
    modelName: "AuthVerification",
    storeIdentifier: "hashed",
  },
  rateLimit: {
    enabled: true,
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
      "/sign-up/email": { window: 60, max: 5 },
      "/reset-password": { window: 60, max: 3 },
      "/forget-password": { window: 60, max: 3 },
      "/verify-email": { window: 60, max: 5 },
      "/magic-link/*": { window: 60, max: 3 },
      "/email-otp/*": { window: 60, max: 3 },
      "/two-factor/*": { window: 60, max: 5 },
    },
  },
  advanced: {
    database: {
      generateId: "uuid",
    },
    ipAddress: {
      // Default header; override per deployment if behind a known proxy.
      ipAddressHeaders: ["x-forwarded-for"],
    },
  },
  plugins: [
    organization({
      allowUserToCreateOrganization: false,
      disableOrganizationDeletion: true,
      requireEmailVerificationOnInvitation: true,
      schema: {
        organization: {
          modelName: "Organization",
          fields: {
            logo: "logoUrl",
            metadata: "authMetadata",
          },
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
    }),
    twoFactor({
      issuer: "ShopOS",
      otpOptions: {
        sendOTP: async ({ user, otp }) => {
          deliver({ kind: "two-factor-otp", to: user.email, otp });
        },
      },
    }),
    passkey(),
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        deliver({ kind: "magic-link-email", to: email, url });
      },
      expiresIn: 5 * 60,
      disableSignUp: false,
    }),
    emailOTP({
      otpLength: 6,
      expiresIn: 5 * 60,
      async sendVerificationOTP({ email, otp, type }) {
        deliver({
          kind: "email-otp",
          to: email,
          otp,
          purpose:
            type === "sign-in"
              ? "sign-in"
              : type === "email-verification"
                ? "email-verification"
                : "forget-password",
        });
      },
    }),
    haveIBeenPwned({
      enabled: config.isProduction,
    }),
    sso({
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
    }),
    nextCookies(),
  ],
});
