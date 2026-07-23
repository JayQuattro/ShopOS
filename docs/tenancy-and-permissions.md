# Tenancy and permissions

## Boundaries

Organization is the primary tenant boundary. Most operational data is also location-scoped. A global
user identity may have memberships in multiple organizations. A membership either grants
organization-wide location access or requires explicit location grants.

Platform administration is a separate security plane. A platform operator is not automatically a shop
member and must use an audited support-access mechanism when that capability is introduced.

## Identity and organization ownership

Better Auth owns global users, credentials, external accounts, sessions, MFA factors, passkeys,
organization invitations, and federated protocol handling. Its Organization plugin maps to the same
ShopOS `organizations` and `organization_memberships` records. It must not create a second organization
graph.

The Better Auth membership role controls authentication-adjacent actions such as invitations and SSO
configuration. ShopOS roles and permissions control operational records. Location access remains a
ShopOS extension. Better Auth's `activeOrganizationId` is a UX convenience, never sufficient
authorization.

A global user may link several identities and join several organizations. Identity linking does not
copy memberships. Revoking membership in one organization does not delete the global user or remove
their access to another organization.

## Microsoft and Google federation

Two distinct modes are supported:

- Platform-wide Microsoft or Google social sign-in authenticates a person. It never auto-provisions an
  organization membership.
- Organization-managed SSO uses Better Auth's SSO plugin. Every provider record is bound to exactly one
  ShopOS organization and uses a unique provider ID.

Initial organization SSO provisioning is invitation-only. A successful OIDC or SAML response must still
match the provider ID, exact issuer, configured Azure tenant ID when applicable, verified Google hosted
domain or configured domain, and the target organization. Email domain alone is never proof of
membership.

Domain ownership verification is required before a provider can be enabled. Automatic account linking
must not be treated as authorization. Just-in-time membership and SCIM provisioning are later,
explicitly audited policies. New SSO-created memberships receive no location grants unless a ShopOS
administrator assigns them.

## Request context

Server code receives an immutable context containing:

- authenticated user ID
- organization ID
- optional location ID
- membership ID
- resolved permissions
- allowed location IDs or organization-wide flag
- request/correlation ID

Client-supplied IDs select a candidate context only. The server rebuilds and verifies it from stored
membership data.

## Roles and permissions

Initial role templates are Owner, Manager, Advisor, Technician, Parts, and Administrator. Authorization
checks use permissions such as `customers.read`, `work_orders.write`, `estimates.present`,
`authorizations.record`, `invoices.issue`, and `payments.record`, not hard-coded role-name comparisons.
Organizations may eventually customize roles without changing policy code.

## Repository rules

- Tenant-owned repository methods require tenant context.
- Queries include organization scope and, for location-limited actors, allowed location scope.
- Lookups return not-found for inaccessible identifiers where revealing existence would leak data.
- Creation derives organization and location from verified context rather than untrusted input.
- Nested writes verify that every referenced parent belongs to the same organization and allowed
  location.

## Required adversarial tests

- An actor in organization A cannot read or mutate organization B by guessing an ID.
- A location-limited actor cannot access another location in the same organization.
- Organization-wide actors can access all current locations in their organization.
- Adding a location later does not silently expand a location-limited membership.
- A child ID from organization A cannot be attached through a parent in organization B.
- Permission denial prevents mutation even when tenant scope is valid.
- Customer authorization tokens expose only their intended revision and expire/revoke correctly.
- A valid identity from an SSO provider bound to organization A cannot enter organization B.
- Azure tenant and OIDC issuer mismatches are denied even when the email domain matches.
- Google Workspace sign-in without a matching verified hosted-domain claim is denied for
  organization-managed SSO.
- Platform-wide Microsoft/Google sign-in does not create organization membership.
- Background jobs revalidate tenant scope when executed.

## Open decisions

PostgreSQL row-level security, support impersonation, ownership-group delegation, custom roles, and
customer-account identity require threat modeling and separate ADRs before implementation.
