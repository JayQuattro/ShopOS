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

Authentication routes, session handling, email verification, password reset, magic-link and email-OTP
sign-in, two-factor and passkey enrollment, and the auth UI are implemented behind a platform-level
delivery boundary. The deterministic console adapter is used in development and tests; a safe null
adapter is the production default until a real email provider is registered behind the same
interface. Tenant-aware request context is implemented: every protected request rebuilds an
immutable authorization context from server-side membership, role/permission, and location-access
records, and the first tenant-scoped repository (customers) proves cross-organization, cross-location,
and permission-denial isolation against a real database. Organization and first-location onboarding,
platform operator authorization, organization lifecycle actions, audit history, and an outbox record
are implemented. Membership, role, permission, location-access, and invitation management — including
privilege-escalation prevention and last-owner safety — are implemented with tenant-scoped services,
API routes, an admin UI, and adversarial integration tests. Outbox dispatch,
subscription/billing reconciliation, support access, and persisted application workflows beyond
customers remain roadmap work. The schema and module boundaries prepare for them but must not be
mistaken for implemented behavior.

## License

No license has been selected yet. Until an OSI-approved license is added, the source is visible but
should not be described as legally open source. Selecting the license is an early governance task.
