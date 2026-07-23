# ADR 0001: TypeScript modular monolith

- Status: Accepted
- Date: 2026-07-23

## Context

ShopOS needs cohesive transactions, clear business boundaries, a responsive web UI, public API
potential, self-hosting, and a low operational burden. The initial team and product boundaries do not
justify distributed services.

## Decision

Build one TypeScript modular monolith using Next.js for web/HTTP delivery and PostgreSQL for durable
state. Organize business logic under domain modules. A background worker may be a separate process from
the same repository and deployment artifact.

## Consequences

Transactions and local development stay simple. Module discipline must be enforced through code review
and tests rather than network boundaries. If a module later needs extraction, its application contracts
and events provide a seam; extraction is not a current goal.
