# ShopOS

ShopOS is an open-source, SaaS-first operations platform for repair, maintenance, fabrication, and
customer-asset service businesses.

The project is in its bootstrap phase. The current repository establishes the product and architecture
contracts, database foundation, tenant authorization primitives, financial calculation kernel,
demonstration shell, and automated tests. The complete customer-to-payment workflow described in the
roadmap is not yet implemented.

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
- [Mobile strategy](docs/mobile-strategy.md)
- [UI, UX, and design system](docs/ui-ux-design-system.md)
- [Design system maintenance](docs/design-system-maintenance.md)
- [Deployment principles](docs/deployment-principles.md)
- [Roadmap](docs/roadmap.md)
- [Planning and issue tracking](docs/planning-and-tracking.md)
- [Architectural decisions](docs/adr)

## Current limitations

The authentication architecture is selected, but the Better Auth schema migration, route, and user
interface are not implemented yet. Persisted application workflows, customer-facing authorization
links, invoicing, payments, file storage, and background-job execution also remain roadmap work. The
schema and module boundaries prepare for them but must not be mistaken for implemented behavior.

## License

No license has been selected yet. Until an OSI-approved license is added, the source is visible but
should not be described as legally open source. Selecting the license is an early governance task.
