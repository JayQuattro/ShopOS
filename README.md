# ShopOS

ShopOS is an open-source, SaaS-first operations platform for repair, maintenance, fabrication, and
customer-asset service businesses.

The project is in its bootstrap phase. The current repository establishes the product and architecture
contracts, database foundation, tenant authorization primitives, financial calculation kernel,
demonstration shell, transactional organization onboarding, an initial SaaS control plane, and
automated tests. The complete customer-to-payment workflow described in the roadmap is not yet
implemented.

## Principles

- One modular monolith with clear business boundaries
- PostgreSQL as the primary store
- Server-enforced organization and location isolation
- Prisma ORM with reviewed SQL migrations for PostgreSQL-specific tenant constraints
- Better Auth with Prisma-backed sessions, organization membership, MFA, passkeys, and isolated SSO
- General Customer, Asset, and Work Order language
- Immutable financial and authorization history
- No proprietary runtime or intentionally crippled community edition

## Local development

Prerequisites:

- Node.js 24 LTS
- pnpm 11
- Docker with Compose, or an existing PostgreSQL 17-compatible database

```bash
cp .env.example .env
docker compose up -d postgres
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Open `http://localhost:3000`. The health endpoint is `http://localhost:3000/api/health`.

The seed is deterministic and intended only for local development. Its credentials and behavior will be
documented when authentication is implemented.

## Self-hosted deployment

ShopOS runs without any ShopOS-operated service. Build the production container and run it behind a
TLS-terminating reverse proxy with PostgreSQL and the background worker:

```bash
# Set required environment variables
export POSTGRES_PASSWORD=your-secure-password
export BETTER_AUTH_SECRET=your-at-least-32-char-secret
export BETTER_AUTH_URL=https://shop.example.com

# Run the full stack (web + worker + postgres)
docker compose -f compose.production.yaml up -d

# Apply migrations as a release step
docker compose -f compose.production.yaml exec web pnpm db:migrate
```

See [Deployment architecture](docs/deployment-architecture.md) for multi-host, HA, and
cloud-managed deployment guidance, backup/restore strategy, and the IaC boundary.

## Integration tests

Integration tests run against a dedicated `shopos_test` PostgreSQL database and exercise real
migrations, constraints, transactions, and tenant-scoped denial paths. The `docker compose up`
PostgreSQL service auto-creates `shopos_test` via an init script.

```bash
docker compose up -d postgres
DATABASE_URL=postgres://shopos:shopos@localhost:5432/shopos_test pnpm db:migrate
pnpm test
```

Tests skip cleanly when PostgreSQL is unreachable (no Docker required for unit tests). The CI
workflow (`.github/workflows/quality.yml`) provisions the test database in a service container and
runs the full gate on every push and pull request.

## Platform administration

The SaaS control plane is available at `/platform` to users with an explicit platform-operator grant.
It is separate from organization membership and requires verified email plus two-factor
authentication. Bootstrap the first operator from a trusted console after that user enrolls MFA:

```bash
pnpm platform:bootstrap-operator --email operator@example.com --role admin
```

The command is intentionally one-time and audited. Do not use an environment-variable email allowlist
or make platform operators members of customer organizations.

## Quality checks

```bash
pnpm check
pnpm build
```

## Documentation

- [Product vision](docs/product-vision.md)
- [Domain language](docs/domain-language.md)
- [Domain model](docs/domain-model.md)
- [Architecture](docs/architecture.md)
- [Tenancy and permissions](docs/tenancy-and-permissions.md)
- [Integration strategy](docs/integration-strategy.md)
- [Localization and translation](docs/localization-and-translation.md)
- [Mobile strategy](docs/mobile-strategy.md)
- [UI, UX, and design system](docs/ui-ux-design-system.md)
- [Design system maintenance](docs/design-system-maintenance.md)
- [Deployment principles](docs/deployment-principles.md)
- [Roadmap](docs/roadmap.md)
- [Planning and issue tracking](docs/planning-and-tracking.md)
- [Architectural decisions](docs/adr)

## Current limitations

The complete customer-to-payment operational workflow is implemented: customers (with contacts and
addresses), assets (with automotive and equipment typed profiles), work orders (with optional/multi
assets, a 10-state state machine with enforcement, and activity feed), estimate revisions (immutable
once presented, with supersession), authorizations (line-level approval/decline with enforcement,
plus expiring revocable customer authorization links), invoices (immutable snapshots from completed
work), and payments (partial and full, with auto-closeout). The operational UI covers the full
lifecycle with dashboard metrics, list/detail pages, create/edit forms, and status transition
actions.

Authentication (sign-in, sign-up, verification, recovery, magic link, email OTP, MFA, passkeys) is
implemented behind a platform-level delivery boundary with the console adapter in development and
a safe null adapter in production. Tenant-aware request context rebuilds permissions from
server-side records on every protected request. Organization onboarding, the SaaS control plane
(platform operators, entitlements, plans, organization lifecycle), and membership/role/location
management are implemented with adversarial integration tests. A transactional-outbox dispatcher
(`pnpm worker`) drains recorded events with tenant-context revalidation.

Not yet implemented: billing webhook reconciliation, real email provider adapters, SSO
(SAML/OIDC/Microsoft/Google), support access/impersonation, native mobile apps, full locale-prefixed
routing, and file storage. The schema and module boundaries prepare for these but must not be
mistaken for implemented behavior.

## License

No license has been selected yet. Until an OSI-approved license is added, the source is visible but
should not be described as legally open source. Selecting the license is an early governance task.
