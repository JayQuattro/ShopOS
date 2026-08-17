# ADR 0015: Parts ordering and the supplier integration seam

- Status: Accepted
- Date: 2026-08-17

## Context

Shops spend significant time waiting on parts. Tracking what was ordered, from whom,
at what cost, and whether it arrived is core operational state — independent of whether
the order was placed by phone, a supplier web portal, or eventually an integrated
parts platform (PartsTech-style catalog search, ordering, and order tracking).

## Decision

Parts ordering is a **local, tenant-owned ledger** first: a `PartSupplier` directory
(per organization) and `PartOrder` records against work orders with ordered lines
(description, supplier part number, quantity, unit cost in integer minor units plus
the organization's ISO currency), received quantities, and a lifecycle
`REQUESTED → ORDERED → RECEIVED` with cancellation before receipt. Every step
narrates into the work-order activity feed so the shop can see why a car is waiting.

Supplier integration, when built, follows ADR 0008's connector model: a
`parts_ordering` capability with org- or platform-scoped `ConnectorInstance`
configuration, and provider adapters behind a `PartsSupplierAdapter` interface
(catalog search, order placement, order status tracking). `PartOrder` already
carries the seam: `source` (`MANUAL` today, `CONNECTOR` later) and a nullable
`external_order_id` for the provider's reference.

## Consequences

Existing part-order history is always readable without any external provider —
integrations accelerate placing and tracking orders, never own the data (AGENTS.md).
Costs recorded at ordering time are historical; price corrections create new
records rather than editing received lines. Connector-backed orders must reconcile
into the same ledger shape: the local record is authoritative for what the shop
owes and what arrived.
