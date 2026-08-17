# ADR 0014: Change orders and supplemental authorization

- Status: Accepted
- Date: 2026-08-17

## Context

Repairs routinely uncover work beyond the approved estimate once the vehicle is in service. The revision
model (ADR 0004) covers pre-authorization correction: superseding a presented estimate replaces it and
requires the customer to approve an entirely new document, discarding the value of the original approval.
Mid-job there is no supported path at all — the work-order state machine has no edge from `AUTHORIZED`
back toward authorization, by design. Re-approval of unchanged, already-approved scope is hostile to
customers and shops alike.

## Decision

Estimate revisions carry a `documentKind`: `BASELINE` (the original estimate lineage) or `CHANGE_ORDER`
(a delta document). A change order:

- references the same work order and contains **only the delta** — added labor/parts/fees, plus credit
  lines (negative unit prices) for reductions;
- never changes work-order status. It exists while the work order is `AUTHORIZED` or `IN_PROGRESS`,
  and customer decisions on it authorize the delta incrementally;
- is presented through the same immutability boundary as a baseline (ADR 0004): sealed totals, per-line
  approve/decline decisions, one-time expiring links;
- may be superseded or voided only while undecided; once any decision is recorded it is history;
- is limited to **one pending change order per work order**. Sequential change orders are expected and
  each is framed against the then-current cumulative authorized total.

Authorization is cumulative: the authorized scope of a work order is the approved lines of the active
baseline plus the approved lines of every decided change order. Invoices assemble from that union
(policy `invoiceLinePolicy`, default `APPROVED_ONLY`, organization-configurable; `ALL_LINES` preserves
the legacy copy-everything behavior). Work orders cannot complete or invoice while a change order is
pending, and the `AUTHORIZED` transition gate considers only baseline approvals.

A change order whose net delta is zero or negative may be applied without customer approval
(policy `changeOrderCreditPolicy`, default `AUTO_APPLY`, organization-configurable). Auto-applied
change orders record a `SYSTEM` authorization and notify the customer; reductions never increase what
a customer owes. `REQUIRE_APPROVAL` restores uniform customer sign-off.

Staff can record decisions on the customer's behalf (phone, in person, email, other) with the
provider's name and a note — the same `Authorization` provenance fields used by customer links.

## Consequences

The original approval stands as history; disputes are investigated per document. Declined delta lines
are documented without blocking the approved baseline. Cumulative math (including negative credit
lines) must be computed from decision state, not from any single revision's totals. Supersede remains
a pre-authorization correction tool; using it to model mid-job discoveries is now an anti-pattern the
services reject. Per-line `authorizationRequired` remains modeled but inactive, and the `EXPIRED`
revision status remains unused — a lapsed pending change order is resolved by re-issuing its link or
voiding it.
