"use client";

import { passkeyClient } from "@better-auth/passkey/client";
import { createAuthClient } from "better-auth/react";
import {
  emailOTPClient,
  magicLinkClient,
  organizationClient,
  twoFactorClient,
} from "better-auth/client/plugins";

import type { auth } from "@/modules/identity/auth";

/**
 * Typed Better Auth client for browser use.
 *
 * The `typeof auth` reference mirrors the server plugin configuration so the
 * client infers the same endpoint and session shapes (organization, two-factor,
 * passkey, magic-link, and email-OTP plugins). The organization client plugin
 * enables `authClient.organization.setActive` for the org switcher.
 */
export const authClient = createAuthClient({
  plugins: [
    passkeyClient(),
    organizationClient(),
    twoFactorClient({
      twoFactorPage: "/verify-2fa",
    }),
    magicLinkClient(),
    emailOTPClient(),
  ],
});

export type AuthClient = typeof authClient;
export type Session = typeof auth.$Infer.Session;
