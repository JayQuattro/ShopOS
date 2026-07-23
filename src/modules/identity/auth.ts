import { passkey } from "@better-auth/passkey";
import { prismaAdapter } from "@better-auth/prisma-adapter";
import { sso } from "@better-auth/sso";
import { betterAuth } from "better-auth";
import { haveIBeenPwned, organization, twoFactor } from "better-auth/plugins";

import { db } from "@/db/client";

export const auth = betterAuth({
  appName: "ShopOS",
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: prismaAdapter(db, {
    provider: "postgresql",
  }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    minPasswordLength: 12,
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
  advanced: {
    database: {
      generateId: "uuid",
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
    }),
    passkey(),
    haveIBeenPwned({
      enabled: process.env.NODE_ENV === "production",
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
  ],
});
