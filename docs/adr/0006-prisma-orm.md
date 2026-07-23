# ADR 0006: Prisma ORM with reviewed PostgreSQL migrations

- Status: Accepted
- Date: 2026-07-23

## Context

The bootstrap initially selected Drizzle because its SQL-adjacent model makes compound tenant
constraints and PostgreSQL-specific migrations straightforward. The project owner prefers Prisma, and
the application needs an approachable generated client, explicit transactions, editable SQL
migrations, and compatibility with Better Auth.

No ORM-backed production workflow or applied migration exists, so changing now has little migration
cost.

## Decision

Use Prisma ORM 7 with the standard PostgreSQL `pg` driver adapter and Better Auth's official Prisma
adapter.

Use Prisma Client inside tenant-scoped repositories and application-service transactions. Keep the
Prisma schema as the declarative application model and commit the full Prisma migration history.
Inspect and amend generated migration SQL for PostgreSQL capabilities that are not completely expressed
by the Prisma schema, including compound tenant foreign keys, check constraints, partial indexes,
immutable-history protections, and future row-level-security policies.

Do not require Prisma Postgres, Prisma Accelerate, or another proprietary Prisma service. ShopOS uses a
normal PostgreSQL connection and remains self-hostable.

## Consequences

Contributors get a generated, discoverable, type-safe client and Better Auth integration without a
second persistence library. Prisma Client generation becomes a required build step. PostgreSQL-specific
invariants still require disciplined SQL migration review; schema generation alone is not the quality
gate.
