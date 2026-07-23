# ShopOS Agent Guide

## Purpose

ShopOS is an open-source, SaaS-first shop operations platform. Automotive repair is the initial market,
but the core domain must remain useful for any business that services, repairs, maintains, modifies, or
builds customer-owned assets.

## Repository structure

- `src/app`: web routes, layouts, and transport adapters
- `src/modules`: business modules organized by domain
- `src/db`: Prisma client lifecycle and repository infrastructure
- `prisma`: Prisma schema, reviewed SQL migrations, and deterministic seed support
- `tests`: integration and cross-module tests
- `docs`: product, architecture, security, and roadmap documentation
- `docs/adr`: accepted and proposed architectural decisions

Route handlers and UI components may validate transport input and call application services. They must
not contain sensitive authorization, financial, or workflow rules.

## Commands

- `pnpm dev`: run the web application
- `pnpm lint`: run static lint checks
- `pnpm format:check`: verify formatting
- `pnpm typecheck`: run strict TypeScript checks
- `pnpm test`: run unit and integration tests
- `pnpm build`: create the production build
- `pnpm db:generate`: generate the Prisma Client
- `pnpm db:migrate:dev`: create and apply a development migration
- `pnpm db:migrate`: deploy existing migrations
- `pnpm db:seed`: load deterministic demonstration data
- `pnpm check`: run the local quality gate

Use Node.js 24 LTS and pnpm 11.

## Coding expectations

- Keep strict TypeScript enabled. Avoid `any`; use `unknown` and narrow it.
- Organize code by business domain, not only by technical layer.
- Use application services/use cases for mutations.
- Keep domain calculations pure where practical.
- Use Prisma Client through tenant-scoped repositories. Raw SQL is acceptable for reviewed
  PostgreSQL-specific constraints, migrations, and measured query hot paths.
- Inspect every generated migration before applying it. Preserve compound tenant foreign keys, check
  constraints, partial indexes, and immutable-history protections that Prisma cannot express directly.
- Represent money as integer minor units plus an ISO currency code. Never calculate money with binary
  floating-point values.
- Use UTC instants for recorded events and an IANA time zone for location-facing dates.
- Treat presented estimates and issued invoices as historical records. Correct them with explicit
  revisions or adjustments rather than destructive edits.
- Use Better Auth with its Prisma adapter for credentials, external accounts, sessions, invitations,
  passkeys, MFA, and
  federated sign-in. Do not implement parallel authentication tables or browser-managed sessions.
- Treat Better Auth's active organization as a selection hint. Rebuild ShopOS tenant permissions from
  server-side membership and location-access records for every protected request.
- Put replaceable integrations behind provider interfaces.
- Add or update an ADR when a durable architectural constraint changes.

## Tenant isolation

Every business record must carry `organization_id`. Operational records normally also carry
`location_id`. Both are authorization boundaries, not display filters.

- Resolve an authenticated actor and explicit tenant context on the server.
- Verify organization membership before loading or mutating business records.
- Verify allowed location access for location-scoped records.
- Scope the first database query by the authorized organization and location; do not fetch globally and
  check afterward when a scoped query is possible.
- Validate nested relationships in the same tenant. A valid child identifier must not authorize access
  through a parent from another organization.
- Do not trust organization, location, role, price, total, or approval state supplied by the browser.
- A Microsoft, Google, OIDC, or SAML identity never grants organization membership by itself. Provider,
  issuer/tenant, organization binding, verified domain, and provisioning policy must all be checked.
- Include `organization_id` in tenant-owned uniqueness constraints and indexes.
- Tenant-aware background jobs must carry and revalidate organization context.

Any new tenant-owned repository or mutation requires tests for cross-organization access,
cross-location access, identifier guessing, and unauthorized mutation.

## Testing requirements

- Unit-test financial rules and state transitions.
- Integration-test database constraints, transactions, and tenant-scoped repositories.
- Authorization tests must prove denial paths, not only happy paths.
- Regression tests accompany bug fixes.
- Tests must be deterministic; freeze or inject time where history is asserted.
- Do not call work complete until lint, formatting, type checking, tests, migrations, and the production
  build pass, or the handoff explicitly lists what is not yet working.

## Working agreements

- Preserve user changes and keep edits scoped to the task.
- Do not add proprietary runtime dependencies.
- Do not make an external provider required to read existing shop data.
- Never put secrets or real customer data in source, fixtures, screenshots, or logs.
- Keep documentation honest about implemented versus planned capabilities.
