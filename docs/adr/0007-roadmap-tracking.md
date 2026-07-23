# ADR 0007: Public roadmap tracking platform

- Status: Proposed
- Date: 2026-07-23

## Context

ShopOS needs a durable backlog, public roadmap, contribution workflow, release planning, and a place to
capture integration ideas without turning every idea into a commitment. The code is intended to be open
source, so contributors should not need access to a private planning system to understand priorities.

## Options

### GitHub Issues and Projects

Keeps issues, pull requests, milestones, discussions, roadmap views, and contribution history together.
It has the lowest synchronization burden and can be public by default.

### Linear with GitHub synchronization

Offers a polished product-development workflow, cycles, initiatives, and timeline planning. It is a
strong internal operating tool, but using both systems requires explicit ownership rules to prevent a
split backlog.

### Plane or OpenProject

Provide self-hostable, open-source planning options with greater operational responsibility. They are
worth reconsidering if roadmap-data sovereignty becomes a requirement.

## Recommendation

Start with GitHub Issues, Discussions, milestones, and one public GitHub Project as the source of truth.
Use Linear later only if a larger product team needs its planning ergonomics; if adopted, enable
two-way GitHub issue synchronization and keep public GitHub issues canonical for community-visible
work.

## Proposed project fields

- Type: initiative, feature, integration, architecture, security, bug, documentation
- Status: inbox, discovery, ready, in progress, review, done, declined
- Horizon: now, next, later, exploring
- Priority: urgent, high, medium, low
- Effort: XS, S, M, L, XL
- Area: identity, tenancy, customers, assets, work, estimates, invoicing, payments, reporting,
  integrations, platform
- Target release
- Public commitment: committed, candidate, idea

## Consequences

The repository and public roadmap remain understandable without another account. GitHub Projects may be
less refined than Linear for product operations. Reassess after multiple active maintainers or a
dedicated product function makes that tradeoff material.
