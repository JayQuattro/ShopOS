# ShopOS Agent Handoff

Last updated: 2026-07-24  
Repository: <https://github.com/JayQuattro/ShopOS>  
Roadmap project: <https://github.com/users/JayQuattro/projects/1>

## Start here

ShopOS is an open-source, SaaS-first operations platform for businesses that service, repair,
maintain, modify, or build customer-owned assets. Automotive repair is the first market, but the core
domain must remain general.

Before changing code:

1. Read `AGENTS.md`.
2. Read `README.md`, `docs/architecture.md`, `docs/tenancy-and-permissions.md`, and
   `docs/roadmap.md`.
3. Read the relevant ADRs in `docs/adr`, especially ADRs 0002, 0005, 0006, 0008, 0010, 0011, 0012,
   and 0013.
4. Inspect the GitHub issue you intend to implement and keep its acceptance criteria current.
5. Start from `main` and preserve unrelated user changes.

Current upstream state:

- Branch: `main`
- Commit: `b30e29b` — `Establish locale foundation with ICU catalogs and formatters (#81)`
- `main` is synchronized with `origin/main`.
- Inspect active branches and pull requests before starting because other agents may be working in the
  shared checkout.

## Technology and architectural choices

- Next.js 16, React 19, strict TypeScript, pnpm 11, and Node.js 24 LTS
- PostgreSQL with Prisma 7; inspect every generated migration before applying it
- Better Auth with the Prisma adapter for authentication, sessions, MFA, passkeys, invitations, and
  future federation
- Modular monolith organized by business domain
- Replaceable provider interfaces for integrations
- shadcn-style customizable components and semantic design tokens
- Locale-prefixed routing, ICU catalogs, formatters, pseudo-locale support, and future
  translation-provider adapters
- React Native with the open-source Expo toolchain for planned Staff, Customer, and qualified branded
  mobile applications

The SaaS product control plane belongs in this application as an isolated platform module. Cloud
infrastructure-as-code should use separate packages or a separate repository, deployment identities,
and credentials.

## What is implemented

### Foundation

- Prisma schema, reviewed PostgreSQL migrations, deterministic seed support, and database helpers
- Tenant-aware financial primitives and authorization policy foundations
- Design-system tokens, theme presets, persisted organization/user appearance preferences, component
  catalog, and responsive authenticated application shell
- Locale-prefixed routes, checked-in ICU catalogs, shared `Intl` formatters, locale resolution, and an
  `en-XA` pseudo-locale foundation
- Architecture, tenancy, integrations, UI/UX, localization, mobile, deployment, and roadmap docs

### Identity

- Better Auth routes and Prisma-backed sessions
- Sign-up, sign-in, verification, password recovery, magic link, email OTP, MFA, and passkey flows
- Provider-neutral authentication delivery boundary
- Development/test console delivery adapter and safe production null adapter
- Platform-wide and organization SSO policy is designed but not yet implemented

### Tenant authorization

- Server-built immutable tenant request context
- Membership administration, invitations, built-in/custom role assignment, last-owner protection, and
  location-access management
- Tenant-scoped customer repository demonstrating organization, location, and permission denial
- Better Auth's active organization is treated only as a selection hint; authorization is rebuilt
  from ShopOS records for every protected request
- Cross-organization, cross-location, nested-resource, unauthorized-mutation, stale-access, and
  suspended-organization denial tests
- Tenant-aware outbox dispatcher and background worker with organization-context revalidation,
  idempotency, retries, and poison-message handling

### SaaS control plane and onboarding

- Separate, MFA-gated `PlatformContext`
- Explicit platform operator grants with viewer/operator/admin roles
- Transactional, idempotent organization onboarding that creates:
  - the organization and first location
  - six built-in roles
  - the founder's Owner membership
  - tenant and platform audit events
  - a provisioning record
  - an outbox event
- Platform organization list/detail views
- Organization suspension and reactivation with required reason and audit history
- Self-service onboarding currently allows a user with no active membership to create one organization
- Platform operators can provision for a verified founder without becoming members of that tenant

Important routes:

- `/sign-in`, `/sign-up`, `/forgot-password`, `/reset-password`, `/security`
- `/onboarding/organization`
- `/platform`
- `/platform/organizations/new`
- `/platform/organizations/[organizationId]`
- `/api/customers`
- `/api/onboarding/organization`
- `/api/platform/organizations`

Bootstrap the first platform operator only from a trusted console after the user has a verified email
and MFA:

```bash
pnpm platform:bootstrap-operator --email operator@example.com --role admin
```

## Recommended next build sequence

### 1. Complete the remaining foundation gates

- [#1 — CI quality workflow and production container](https://github.com/JayQuattro/ShopOS/issues/1)
- [#2 — database-backed integration harness](https://github.com/JayQuattro/ShopOS/issues/2)
- [#54 — accessibility and visual-regression baseline](https://github.com/JayQuattro/ShopOS/issues/54)
- [#59 — pseudo-locale, RTL, and multilingual UI gates](https://github.com/JayQuattro/ShopOS/issues/59)

### 2. Build customers and assets

- [#11 — individual and business customer records](https://github.com/JayQuattro/ShopOS/issues/11)
- [#12 — general assets and typed profiles](https://github.com/JayQuattro/ShopOS/issues/12)
- [#13 — fast tenant-scoped customer and asset lookup](https://github.com/JayQuattro/ShopOS/issues/13)

Keep records general enough for automotive, motorcycle, equipment, and other customer-owned assets.

### 3. Build the first complete operational vertical

Continue through work orders, estimates/authorization, invoices, and payments in roadmap order. Keep
mobile-facing application-service and future versioned API contracts in mind, but do not build native
screens ahead of stable server workflows.

### 4. Continue the SaaS control plane

- [#72 — operator grant management, expiry, and revocation](https://github.com/JayQuattro/ShopOS/issues/72)
- [#73 — plans, entitlements, and billing reconciliation](https://github.com/JayQuattro/ShopOS/issues/73)
- [#75 — isolated SaaS deployment infrastructure](https://github.com/JayQuattro/ShopOS/issues/75)
- [#74 — audited time-limited support access](https://github.com/JayQuattro/ShopOS/issues/74) is
  discovery/later work and must be threat-modeled before implementation

SSO can wait until the tenant membership model and core app shell are solid.

### 5. Native, desktop, and white-label application program

The accepted plan is in `docs/mobile-strategy.md` and ADR 0013. The coordinating roadmap issue is
[#82](https://github.com/JayQuattro/ShopOS/issues/82), with delivery issues:

- [#89 — native identity, API, device, push, and deep-link foundation](https://github.com/JayQuattro/ShopOS/issues/89)
- [#83 — technician-first ShopOS Staff alpha](https://github.com/JayQuattro/ShopOS/issues/83)
- [#87 — shared multi-shop ShopOS Customer beta](https://github.com/JayQuattro/ShopOS/issues/87)
- [#90 — entitlement-controlled branded-app model](https://github.com/JayQuattro/ShopOS/issues/90)
- [#91 — deterministic branded-app release factory](https://github.com/JayQuattro/ShopOS/issues/91)
- [#92 — desktop shell versus installable PWA evaluation](https://github.com/JayQuattro/ShopOS/issues/92)

React Native/Expo is the iOS/Android direction. The shared ShopOS Customer app is the default. Qualified
white-label customer apps use the same codebase and normally publish from the shop's organization
developer accounts. Desktop remains PWA-first until native-device requirements are proven.

## Non-negotiable rules

- Every tenant business record carries `organization_id`; operational records normally also carry
  `location_id`.
- Scope the first database query to the authorized tenant and location whenever possible.
- A valid external identity never grants tenant membership by itself.
- Platform-operator access never implies organization membership.
- Do not implement default impersonation or invisible support access.
- Put sensitive rules in application services, not route handlers or UI components.
- Use integer minor units plus ISO currency for money; never binary floating point.
- Use UTC for recorded instants and IANA time zones for location-facing dates.
- Preserve issued financial and authorization history through revisions or adjustments.
- Keep provider credentials and connector configuration in database-backed, scoped configuration with
  proper secret handling—not feature-specific environment variables.
- Add or update an ADR when a durable architectural constraint changes.

## Known gaps

- Customer, asset, work-order, estimate, invoice, and payment workflows are not built.
- Platform operator grants are bootstrap-only; there is no management UI yet.
- Entitlements can be represented but billing reconciliation and enforcement are not implemented.
- No production email provider is configured.
- Microsoft/Google/OIDC/SAML SSO is planned, not active.
- Native Staff, Customer, branded, and desktop applications are planned but not implemented.
- Support access/impersonation is deliberately absent.
- No OSI license has been selected yet.

## Local setup and completion checks

```bash
cp .env.example .env
docker compose up -d postgres
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Before handing off work:

```bash
pnpm check
pnpm build
```

Any schema change also requires a reviewed migration and a fresh-database migration verification.
Tenant-owned repositories and mutations require tests for cross-organization access, cross-location
access, identifier guessing, and unauthorized mutation. Keep documentation and GitHub issue status
honest about what is implemented versus only modeled or planned.

## Recent merged work

- [PR #76 — membership, roles, permissions, and location access](https://github.com/JayQuattro/ShopOS/pull/76)
- [PR #77 — outbox dispatcher and tenant-aware background worker](https://github.com/JayQuattro/ShopOS/pull/77)
- [PR #78 — security test matrix and suspended-organization isolation](https://github.com/JayQuattro/ShopOS/pull/78)
- [PR #79 — authenticated application shell](https://github.com/JayQuattro/ShopOS/pull/79)
- [PR #80 — organization and user theme preferences](https://github.com/JayQuattro/ShopOS/pull/80)
- [PR #81 — locale foundation with ICU catalogs and formatters](https://github.com/JayQuattro/ShopOS/pull/81)
