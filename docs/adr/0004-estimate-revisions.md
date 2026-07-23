# ADR 0004: Immutable presented estimate revisions

- Status: Accepted
- Date: 2026-07-23

## Context

Overwriting a proposal after it is shown or authorized destroys evidence of the customer's decision.

## Decision

An estimate is a logical container with ordered revisions. A draft revision may be edited. Presentation
seals its line, pricing, tax, and explanatory snapshot. Any later change creates another revision.
Authorization records point to one sealed revision and explicit approved/declined scope.

## Consequences

Historical meaning is trustworthy and disputes can be investigated. UI and services must distinguish the
latest draft, latest presented revision, and authorized revision. Invoice generation snapshots completed
authorized work instead of treating an estimate as a mutable invoice.
