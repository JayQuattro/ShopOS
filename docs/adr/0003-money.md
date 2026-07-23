# ADR 0003: Integer minor-unit money

- Status: Accepted
- Date: 2026-07-23

## Context

Labor quantities, part quantities, discounts, and taxes require deterministic totals. JavaScript
floating-point arithmetic is unsafe for currency.

## Decision

Store finalized monetary amounts as signed 64-bit integer minor units with an ISO currency code.
Intermediate quantity and rate inputs use scaled integers. Central calculation functions define
rounding, discount, and tax order. Estimate and invoice snapshots persist calculated components.

## Consequences

Calculations are deterministic and easy to test. Very high values require safe-integer guards in
JavaScript and may later move to bigint-aware serialization. Currencies with nonstandard minor units and
jurisdictional tax rules require explicit configuration rather than an implicit two-decimal assumption.
