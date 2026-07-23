# Architecture

## Shape

ShopOS is one deployable TypeScript modular monolith:

- Next.js renders the responsive web application and exposes required HTTP endpoints.
- shadcn/ui supplies source-owned interface primitives composed into ShopOS domain components. Semantic
  design tokens support validated presets and organization/user appearance preferences.
- Prisma ORM provides the generated, type-safe persistence client. Prisma Migrate manages migration
  history, while reviewed migration SQL preserves PostgreSQL-specific tenant constraints, checks, and
  indexes.
- Better Auth owns authentication credentials, linked external accounts, sessions, MFA, passkeys,
  invitations, and federation protocol handling through its Prisma adapter.
- Domain modules contain entities, policies, calculations, application services, and repository
  contracts.
- Versioned ICU message catalogs and locale services localize ShopOS-owned interface copy without a
  runtime translation provider.
- PostgreSQL is the source of truth.
- A worker process will consume a database-backed outbox/job queue without introducing a microservice.
- A dedicated integrations module registers replaceable adapters and resolves database-backed,
  tenant-scoped connector instances for communication, storage, mapping, scheduling, payments,
  accounting, translation, and data services.

The browser is not a security boundary. Server application services authorize tenant context and perform
mutations. Route handlers translate HTTP concerns and call those services.

## Module map

Initial modules:

- identity
- organizations
- locations
- memberships
- customers
- assets
- work-orders
- estimates
- authorizations
- invoicing
- payments
- notes
- files
- activity
- audit
- settings
- terminology
- localization
- translation
- integrations

Planned boundaries include scheduling, inspections, inventory, purchasing, vendors, projects,
messaging, reporting, accounting, catalogs, and workflow automation.

Dependencies point toward stable domain contracts. Work orders may request customer and asset summaries
through module APIs; they should not join arbitrary implementation tables from route code.

The UI follows the same boundary. `src/components/ui` contains shared primitives,
`src/components/shopos` contains domain compositions, and feature routes call application services.
Theme configuration changes presentation only; it never changes authorization, workflow, or financial
semantics. UI locale and content translation are also presentation concerns: locale never selects
currency, time zone, tenant, or authority. Application messages come from checked-in catalogs;
translated user content remains a derived projection whose canonical source is owned and authorized by
its domain module.

## Request path

1. Authentication resolves a user.
2. Better Auth's active organization or the route selects a candidate organization.
3. Membership policy grants organization-wide or selected-location access.
4. The server resolves a supported presentation locale without treating it as authority.
5. Input is validated at the transport boundary.
6. An application service revalidates resource scope, applies domain rules, and commits a transaction.
7. The transaction records domain/activity/audit events and an outbox message when needed.
8. The response exposes a stable locale-aware view model, not raw database rows.

## Data and consistency

PostgreSQL constraints, tenant-scoped indexes, and explicit Prisma transactions protect invariants.
Application repositories require tenant context. Generated migrations are reviewed and extended with
SQL when compound tenant foreign keys, checks, partial indexes, or other PostgreSQL capabilities are
not fully represented by the Prisma schema. Row-level security is a defense-in-depth candidate, not a
substitute for service authorization; its production adoption remains to be proven by an ADR and
connection-pooling design.

Integration adapter definitions are code-shipped, while connector instances, assignments,
non-secret configuration, lifecycle state, and secret references are persisted. Connector resolution
uses explicit organization and optional location context. Platform-managed connections require
per-organization entitlement and isolation; no connector may silently cross tenant boundaries.

## APIs

Only workflow endpoints needed by the web application are implemented initially. Application service
contracts should remain reusable by a future `/api/v1` public API. Future design must address
pagination, idempotency, OAuth clients, API keys, scopes, rate limits, webhooks, bulk operations, and
audit behavior before declaring the API stable.

## Observability and errors

Use structured logs with request, organization, location, actor, and trace identifiers where safe.
Never log secrets, authorization tokens, or customer contact details by default. Domain errors map to
stable error codes. A health endpoint distinguishes process liveness from future database readiness.
Translation metrics record provider, locale pair, usage, latency, and normalized outcome without
logging source or translated content.

## Current implementation status

The repository currently implements the scaffolding, initial schema, pure financial, tenant, and
federated-provider isolation policies, Better Auth's reviewed schema and guarded server configuration,
the Tailwind/shadcn design-system foundation, the demonstration application shell, health response, and
tests. Authentication routes, recovery delivery, sign-in and enrollment UI, the authenticated
application shell, persisted organization/user appearance settings, workflow services, the job runner,
outbox dispatcher, storage providers, and a stable public API remain planned. The configurable adapter
model is accepted, but its registry, connector persistence, administration UI, secret lifecycle, jobs,
and provider implementations are not yet implemented. The localization model is accepted, but
locale-aware routing, message catalogs, translated-content persistence, translation jobs, and provider
adapters are not yet implemented.
