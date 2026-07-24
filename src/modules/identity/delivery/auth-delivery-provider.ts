/**
 * Platform-level auth message delivery boundary.
 *
 * Auth messages (email verification, password reset, magic links, OTPs, and
 * second-factor OTPs) fire before a user has a ShopOS organization. They cannot
 * use the org-scoped {@link import("@/modules/integrations/contracts").EmailProvider},
 * which requires an `organizationId`. This boundary keeps auth delivery
 * replaceable without coupling it to tenant-scoped integration connectors.
 *
 * Implementations must never log tokens, reset URLs, OTPs, passwords, or message
 * bodies. They should resolve without throwing in production so that recovery
 * endpoints never reveal whether an address exists. ADR 0011 documents this split.
 */

export type AuthDeliveryMessage =
  | VerificationEmailMessage
  | PasswordResetEmailMessage
  | MagicLinkEmailMessage
  | EmailOtpMessage
  | TwoFactorOtpMessage;

export type VerificationEmailMessage = Readonly<{
  kind: "verification-email";
  to: string;
  url: string;
}>;

export type PasswordResetEmailMessage = Readonly<{
  kind: "password-reset-email";
  to: string;
  url: string;
}>;

export type MagicLinkEmailMessage = Readonly<{
  kind: "magic-link-email";
  to: string;
  url: string;
}>;

export type EmailOtpMessage = Readonly<{
  kind: "email-otp";
  to: string;
  otp: string;
  purpose: "sign-in" | "email-verification" | "forget-password";
}>;

export type TwoFactorOtpMessage = Readonly<{
  kind: "two-factor-otp";
  to: string;
  otp: string;
}>;

export interface AuthDeliveryProvider {
  readonly key: string;
  send(message: AuthDeliveryMessage): void;
}
