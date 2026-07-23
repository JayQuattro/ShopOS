# ADR 0005: Better Auth with organization-isolated federation

- Status: Accepted
- Date: 2026-07-23

## Context

ShopOS needs local authentication, secure sessions, passkeys, MFA, organization invitations, and
optional Microsoft Entra ID, Google Workspace, OIDC, and SAML sign-in. A person may belong to several
shops, and a single external identity must not imply access to every organization with a similar email
domain.

## Decision

Use Better Auth through its official Prisma adapter.

Better Auth owns global users, credentials, linked accounts, sessions, verification tokens, MFA factors,
passkeys, invitations, and federation protocol processing. Enable these plugins where configured:

- Organization
- SSO
- Two-factor authentication
- Passkey
- Have I Been Pwned for production password checks
- CAPTCHA for internet-facing credential endpoints when a provider is configured

Map the Organization plugin to the existing ShopOS `organizations` and
`organization_memberships` models. Better Auth's membership role governs invitations and SSO
administration. ShopOS's role/permission and location-access records remain authoritative for shop data.
Do not model locations as Better Auth teams.

Support platform-wide Microsoft and Google social login as identity methods only. Support
organization-managed Microsoft Entra ID, Google Workspace, OIDC, and SAML through a provider record
bound to exactly one organization. Initial federation provisioning is invitation-only.

After Better Auth validates the protocol response, ShopOS additionally requires:

- matching provider ID and target organization
- exact configured issuer
- matching Azure tenant ID when configured
- verified email
- matching verified Google hosted domain or configured provider domain
- an existing membership or invitation for that same organization

The active organization stored in a session is a selection hint. Every protected request reloads
membership, permissions, and location access on the server.

Do not enable the Better Auth Admin plugin or impersonation initially. SCIM, just-in-time membership,
API keys, and an OAuth provider remain later capabilities.

## Consequences

Authentication features use a maintained framework without outsourcing the ShopOS tenant boundary.
External identity outages do not make established shop records unreadable by other configured sign-in
methods. The Better Auth schema must be generated and reviewed before migration because it will share
core organization and membership models.

SSO client secrets need encrypted storage or a secret reference before self-service configuration is
safe. Account linking may merge global identities, but it never adds or copies ShopOS membership.

## Implemented schema boundary

The reviewed `20260723224250_better_auth_schema` migration extends the existing ShopOS identity graph
instead of creating parallel users, organizations, or memberships:

- Better Auth's `user.name` maps to `User.displayName`.
- Better Auth's organization and member models map to `Organization` and
  `OrganizationMembership`; its adjacent role is stored separately as `authRole`.
- `AuthSession`, `AuthAccount`, and `AuthVerification` own sessions, credentials/external identities,
  and short-lived verification material.
- Organization invitations, two-factor secrets, passkeys, and organization-bound SSO providers use
  dedicated auth-owned tables.
- UUID keys, reviewed foreign keys, expiry indexes, credential/provider uniqueness, passkey credential
  uniqueness, and plugin-state check constraints are explicit in SQL.

The server configuration disables direct organization creation and deletion through Better Auth,
requires verified-email invitations, disables implicit account linking, and disables implicit SSO
signup and organization provisioning. SSO providers require domain verification and are database-bound
to exactly one ShopOS organization. SAML assertions require request correlation and timestamp
conditions; unsolicited IdP-initiated responses are disabled.

The SSO provider schema exists so the contract is reviewable, but organization SSO routes and
self-service configuration must not be enabled until provider secrets are encrypted or replaced with
secret references. The active organization stored on an auth session remains a selection hint and
never substitutes for ShopOS membership, permission, or location checks.
