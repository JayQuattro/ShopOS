# ShopOS

**Open-source shop operations for repair, maintenance, fabrication, and any business that services
customer-owned assets.** Automotive repair is the first market, but the core language — customers,
assets, work orders, estimates, parts, invoices — is deliberately general.

ShopOS runs as a single deployable stack you can self-host, with your data in your own PostgreSQL.
Every external dependency (payments, maps, video, storage) sits behind a provider interface — no
vendor is required to read your own records, and there is no crippled community edition.

[![Work board](docs/screenshots/work-board.png)](docs/screenshots/work-board.png)
[![Work order](docs/screenshots/work-order-detail.png)](docs/screenshots/work-order-detail.png)
[![Key board](docs/screenshots/key-board.png)](docs/screenshots/key-board.png)
[![Roadside](docs/screenshots/roadside.png)](docs/screenshots/roadside.png)

## What's in it today

The full customer-to-payment workflow is implemented and covered by 640+ integration tests,
including cross-tenant denial paths:

- **Work orders** with an enforced 10-state lifecycle, board view, canned jobs, tasks, labor time,
  quality checks, and a tabbed detail screen with a multi-RO workspace
- **Estimating** the way shops think: lines grouped into jobs (drag and drop), good/better/best
  option groups the customer picks from, immutable revisions, change orders, and line-level
  authorization via signed links, email, or staff recording
- **Digital vehicle inspections** with photos and video, flowing into estimates with evidence
  attached, plus a customer tracker link and portal
- **Parts and inventory**: suppliers, purpose-tracked orders, receiving, waiting-on-vendor board,
  OE/aftermarket numbers, interchange, units of measure, cores, reorder points
- **Billing and payments**: invoice series with tax IDs and VAT handling, AR aging and statements,
  deposits, split tender, refunds, cash drawer reconciliation — card payments through your own
  Stripe / Square / Adyen / Mollie / Mercado Pago / Razorpay account, or cash/check with no
  processor at all
- **Beyond the bay**: roadside dispatch with routing, pickup & delivery, fleet and loaners,
  key board, declined-work follow-ups
- **International-ready**: regional formats per location, stacked taxes, e-invoicing formats
  (Factur-X, XRechnung, FatturaPA), E.164 phones, holiday calendars, country-aware addresses

See the [feature tour](docs/features.md) for the complete, honest inventory — including what is
**not** built yet.

## Try it in five minutes

Prerequisites: Node.js 24 LTS, pnpm 11, Docker (or an existing PostgreSQL 17-compatible database).

```bash
cp .env.example .env
docker compose up -d postgres
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Open `http://localhost:3000` and sign in with the seeded demo accounts:

| Who             | Sign-in                                     | Notes              |
| --------------- | ------------------------------------------- | ------------------ |
| Shop owner      | `owner@example.test` / `demo-password-123`  | full access        |
| Technician      | `maria@example.test`                        | magic-link sign-in |
| Customer portal | `driver@example.test` / `demo-password-123` | `/portal`          |

The seed is deterministic and loaded with a realistic shop: customers, vehicles, work orders at
every lifecycle stage, estimates with options, parts orders, invoices, and payments.

## Self-hosted deployment

ShopOS runs without any ShopOS-operated service:

```bash
export POSTGRES_PASSWORD=your-secure-password
export BETTER_AUTH_SECRET=your-at-least-32-char-secret
export BETTER_AUTH_URL=https://shop.example.com

docker compose -f compose.production.yaml up -d          # web + worker + postgres
docker compose -f compose.production.yaml exec web pnpm db:migrate
```

See [Deployment architecture](docs/deployment-architecture.md) for multi-host, HA, and
cloud-managed guidance, backup/restore, and the IaC boundary.

## Feedback and contributing

This project is heading toward its initial open-source release and early feedback shapes it:

- **Try the demo flow above and tell us what's missing for your shop** — open a
  [discussion](../../discussions) with your use case, or an [issue](../../issues) for anything
  broken or confusing.
- Real-world gaps from working shops (yours) are the highest-value reports: what did you look for
  and not find? Where did the flow fight you?
- Code contributions follow the repository conventions in `AGENTS.md` and the docs below; the
  quality gate (`pnpm check && pnpm build`) is the arbiter.

## Documentation

- [Feature tour](docs/features.md) — what works today
- [Product vision](docs/product-vision.md) · [Domain language](docs/domain-language.md) ·
  [Domain model](docs/domain-model.md)
- [Architecture](docs/architecture.md) · [Tenancy and permissions](docs/tenancy-and-permissions.md)
- [Integration strategy](docs/integration-strategy.md) ·
  [Localization and translation](docs/localization-and-translation.md)
- [UI, UX, and design system](docs/ui-ux-design-system.md) · [Mobile strategy](docs/mobile-strategy.md)
- [Deployment principles](docs/deployment-principles.md) · [Roadmap](docs/roadmap.md)
- [Architectural decisions](docs/adr)

## Development

```bash
pnpm check   # lint + format + typecheck + tests (the local quality gate)
pnpm build   # production build
```

Integration tests run against a dedicated `shopos_test` database (auto-created by the compose
PostgreSQL service) and exercise real migrations, constraints, transactions, and tenant-scoped
denial paths:

```bash
docker compose up -d postgres
DATABASE_URL=postgres://shopos:shopos@localhost:5432/shopos_test pnpm db:migrate
pnpm test
```

Unit tests run without Docker; integration tests skip cleanly when PostgreSQL is unreachable.

Platform administration lives at `/platform` behind an explicit, MFA-gated operator grant
(`pnpm platform:bootstrap-operator --email operator@example.com --role admin`). It is intentionally
separate from organization membership.

## Status and license

Implemented vs planned capabilities are tracked honestly in the
[feature tour](docs/features.md). Headline gaps today: SSO federation for customer organizations,
production email delivery adapters, native mobile apps, and full locale-prefixed routing.

No license has been selected yet. Until an OSI-approved license is added, the source is visible
but should not be described as legally open source — selecting the license is the immediate
governance task ahead of the first release.
