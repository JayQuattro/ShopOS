# ADR 0011: Auth delivery is a platform-level boundary, not an org connector

- Status: Accepted
- Date: 2026-07-23

## Context

Authentication messages (email verification, password reset, magic links, one-time passwords, and
second-factor OTPs) must be delivered before a user is known to belong to any ShopOS organization.
The recovery and verification endpoints must also fail safely and never reveal whether an email
address exists.

The tenant-scoped integration connectors defined in ADR 0008 and
`src/modules/integrations/contracts.ts` require an `organizationId` on every call. They are
configured per organization and per location, and they carry the tenant-isolation guarantees
(tenancy-and-permissions) that depend on resolved membership. None of those invariants hold at the
point an unauthenticated visitor requests a password reset or a verification code.

## Decision

Introduce a platform-level auth delivery boundary (`AuthDeliveryProvider`) in
`src/modules/identity/delivery`, separate from the organization-scoped `EmailProvider` connector.

- The boundary is pre-tenant. It accepts only what an auth flow knows: a recipient address, a
  message kind, and the URL or OTP to deliver.
- A deterministic `ConsoleAuthDeliveryProvider` captures messages for development and tests without
  sending real email. It never logs tokens, reset URLs, OTPs, or message bodies.
- A `NullAuthDeliveryProvider` is the production default when no real provider is configured. It
  resolves without throwing so recovery endpoints remain usable and never reveal whether an address
  exists. An unconfigured deployment fails closed rather than crashing the request.
- Better Auth's `sendVerificationEmail`, `sendResetPassword`, `sendMagicLink`,
  `sendVerificationOTP`, and two-factor `sendOTP` callbacks delegate to this boundary. They remain
  fire-and-forget per Better Auth's timing-attack guidance.
- Real providers (SMTP, Resend, SendGrid, Mailgun, SES) will be added behind the same interface as
  reviewable adapters. They are not required to read existing auth data and will follow the
  integration-adapter discovery and data-handling rules from ADR 0008 where they overlap with tenant
  messaging.

## Consequences

Auth delivery is replaceable without coupling credential recovery to tenant-scoped connectors, and a
self-hosted deployment can run auth end-to-end with no external provider. The split means two email
boundaries exist: platform-level auth delivery (this ADR) and organization-scoped transactional
connectors (ADR 0008). They will share provider libraries where sensible but not the contract,
tenant context, or configuration surface.
