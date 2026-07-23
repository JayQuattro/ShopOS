# ADR 0002: Organization and location tenant context

- Status: Accepted
- Date: 2026-07-23

## Context

Users may join multiple organizations and may have organization-wide or selected-location access.
Client-side filtering cannot protect shop data.

## Decision

Organization is the primary tenant boundary. Operational records normally include a location boundary.
Server code resolves an immutable authorization context from authenticated membership data. Repositories
require that context and scope their initial queries. Application services verify permissions and nested
tenant relationships before mutation.

## Consequences

Tenant identifiers are intentionally repeated in operational tables and indexes. Every new repository
requires adversarial isolation tests. PostgreSQL row-level security remains a possible defense in depth,
pending a separate decision about pooling and administrative access.
