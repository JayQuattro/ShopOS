# ADR 0012: Keep the SaaS control plane in the modular monolith with a separate security context

- Status: Accepted
- Date: 2026-07-23

## Context

ShopOS is SaaS-first and also supports self-hosting. The product needs installation-wide operations
such as organization provisioning, lifecycle management, entitlements, operator grants, and platform
audit history. These actions exist before or above any single organization and therefore cannot use an
organization membership as their authority.

Creating a second application or service now would duplicate authentication, deployment, domain
contracts, and data access before operational scale requires it. Treating a shop Owner or Better Auth
global administrator as a platform operator would collapse the tenant and platform security planes.

Cloud infrastructure provisioning is a different concern from product control-plane operations. The
runtime web application must not hold infrastructure-as-code credentials.

## Decision

- Keep the tenant application and product control plane in the same TypeScript modular monolith and
  PostgreSQL database initially.
- Expose platform administration under a distinct `/platform` route group backed by
  `src/modules/platform`.
- Resolve a dedicated `PlatformContext` from an explicit, revocable, optionally expiring operator
  grant. A platform context is never accepted as a tenant context.
- Require an enabled, verified user with two-factor authentication for platform access.
- Define code-owned Viewer, Operator, and Admin platform roles with explicit platform permissions.
- A platform operator receives no organization membership automatically and cannot open tenant
  operational records through platform authority.
- Bootstrap the first operator through a one-time trusted CLI workflow; subsequent operator management
  requires a platform-admin workflow and independent audit history.
- Keep Better Auth's generic organization creation and deletion endpoints disabled. Self-service and
  operator-driven onboarding call one ShopOS `ProvisionOrganization` application service.
- Provision the organization, first location, built-in roles, founding Owner membership, audit events,
  idempotency record, and outbox event in one reviewed Prisma transaction.
- Treat organization lifecycle and subscription lifecycle as separate constrained states. Suspension
  never deletes or silently reallocates tenant data.
- Store platform audit records separately from tenant audit records. A platform event may reference an
  organization as its target without becoming tenant-owned authority.
- Keep cloud infrastructure-as-code in a separate package or repository with separate CI credentials.
  Organization onboarding does not provision one cloud stack or database per tenant in the shared
  SaaS model.

## Consequences

- One deployment remains simple while module and authorization boundaries permit a future
  `admin.shopos.com` hostname or separate control-plane deployment.
- Global control-plane tables are explicit exceptions to the normal `organization_id` rule.
- Every platform route and mutation requires denial-path tests for missing, expired, revoked,
  insufficient, disabled, and MFA-incomplete operator access.
- Support access, impersonation, arbitrary database editing, and hard organization deletion remain
  unavailable until separately threat-modeled.
- External billing, welcome delivery, and integration setup consume outbox events after the core
  tenant transaction commits.

## Rejected alternatives

### Make platform operators members of every organization

Rejected because membership would silently grant tenant data access, contaminate membership history,
and make revocation unreliable.

### Use Better Auth's Admin plugin as the ShopOS control plane

Rejected because authentication administration and SaaS product operations have different authority,
audit, and data-access requirements. Selected user/session operations may be integrated later behind
ShopOS platform permissions.

### Build a separate control-plane service immediately

Rejected because it adds distributed transactions and duplicated delivery infrastructure without a
current scaling or compliance requirement.

### Let the runtime application manage Terraform or cloud accounts

Rejected because product runtime compromise must not grant infrastructure deployment authority.
