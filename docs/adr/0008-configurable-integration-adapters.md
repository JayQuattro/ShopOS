# ADR 0008: Configurable scoped integration adapters

- Status: Accepted
- Date: 2026-07-23

## Context

ShopOS will integrate with communication, storage, mapping, scheduling, payments, accounting,
automotive data, repair information, parts ordering, and other provider ecosystems. Some connections
may be operated by the ShopOS platform as a service, while others use organization-owned or
location-specific provider accounts.

Provider selection and credentials cannot be deployment-wide environment variables. That approach
cannot safely support self-service configuration, credential rotation, organizations choosing
different providers, location overrides, OAuth reauthorization, platform-managed entitlements, or an
auditable SaaS control plane.

## Decision

Implement integrations through code-shipped adapter definitions and persisted connector instances,
assignments, and secret references.

An adapter definition declares versioned capabilities, directionality, configuration schema,
authentication modes, normalized errors, health and retry behavior, idempotency, webhooks, and relevant
data-handling constraints. Provider SDKs remain inside the adapter package.

A connector instance has exactly one ownership scope:

- platform
- organization
- organization location

The management mode records whether ShopOS operates the provider account as a platform service or the
customer supplies and controls its own account. A platform connector still requires an explicit
organization assignment, entitlement, isolated sender/namespace or equivalent provider boundary,
consent where applicable, and quotas. Organization credentials are never reusable by another tenant.

Connector assignments select instances by capability and tenant context. Resolution prefers an
explicit location assignment, then an organization assignment, then an explicitly enabled platform
service. Fallback is opt-in, capability-compatible, and bounded by data residency, consent, commercial,
and tenant-isolation rules.

Provider selection, routing, non-secret configuration, lifecycle, and access are database-backed and
managed through authorized application services and administration UI. Raw credentials use envelope
encryption or an external secret reference and are write-only through the application. Only the
installation's root secret-protection bootstrap may use deployment secrets.

The initial adapter runtime is a reviewed extension boundary inside the modular monolith and worker. It
does not load arbitrary organization-supplied code.

## Consequences

Organizations can use platform-provided services or bring their own provider accounts without
deployment changes. Locations can override a connector only when explicitly authorized. Configuration
and rotation become auditable product workflows rather than operations tickets.

The model requires a connector registry, configuration-schema versioning, encrypted secret lifecycle,
assignment resolution, health and reauthorization states, an administration UI, tenant-aware jobs,
webhook routing, usage metering where platform services are billable, and comprehensive cross-tenant
tests.

Provider-specific tables and environment-variable switches may appear simpler initially, but they
would multiply configuration paths and make tenant-safe routing, self-service administration, and
provider replacement substantially harder.
