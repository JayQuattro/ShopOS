# Roadmap

Roadmap state is deliberately explicit: complete means implemented and verified, not merely modeled.

## Phase 0 - Foundation

- [x] Product, domain, architecture, tenancy, integration, mobile, and deployment documentation
- [x] Initial ADRs
- [x] Strict TypeScript application scaffold, Prisma ORM, and PostgreSQL development service
- [x] Initial database schema and migration
- [x] Financial calculation and tenant-policy primitives with unit tests
- [x] Health endpoint and responsive product shell
- [x] UI/UX principles, customizable theme architecture, and shadcn design-system decision
- [ ] Tailwind/shadcn foundation, semantic tokens, typography, spacing, motion, and component catalog
- [ ] Light, Dark, Warm, Dusk, and System presets with automated contrast checks
- [ ] Responsive authenticated app shell and standard record/list/form/feedback patterns
- [ ] CI workflow and container production image
- [ ] Database-backed integration-test harness

## Phase 1 - Identity and tenancy

- [x] Select Better Auth with the official Prisma adapter and record the identity/authorization split
- [x] Define organization-isolated Microsoft, Google Workspace, OIDC, and SAML policy
- [x] Generate and review the Better Auth schema migration
- [ ] Configure secure sessions, email/password recovery, MFA, passkeys, and auth routes
- [ ] Configure optional platform-wide Microsoft and Google sign-in without membership provisioning
- [ ] Implement invitation-only organization SSO with verified domain and issuer/tenant checks
- [ ] Organization and first-location onboarding
- [ ] Membership, role, permission, and location-access management
- [ ] Organization theme publishing and individual appearance/density preferences
- [ ] Tenant-aware request context and repositories
- [ ] Cross-tenant, cross-location, nested-resource, and mutation-denial integration tests

## Phase 2 - Customers and assets

- [ ] Individual and business customers
- [ ] Contacts, addresses, preferences, notes, and organization references
- [ ] General assets with automotive and equipment typed profiles
- [ ] Fast tenant-scoped customer and asset search

## Phase 3 - Repair work orders

- [ ] Concerns, requested services, assignments, blockers, and controlled statuses
- [ ] Labor, parts, fees, discounts, taxes, and clear totals
- [ ] Activity history and audit trail

## Phase 4 - Estimates and authorization

- [ ] Immutable presented estimate revisions
- [ ] Line or service-group approval and decline
- [ ] Expiring, revocable customer authorization links
- [ ] Enforcement preventing unauthorized work from becoming approved or complete

## Phase 5 - Invoices and payments

- [ ] Invoice snapshot from completed authorized work
- [ ] Partial and full manual payment recording
- [ ] Remaining balance and closeout rules

## Phase 6 - Demonstration and hardening

- [ ] Deterministic automotive, motorcycle, and lawn-equipment examples
- [ ] Disabled future custom-build example without fake project functionality
- [ ] Full workflow integration tests
- [ ] Representative-role usability testing and accessibility, responsive, keyboard, zoom, and
      screen-reader review
- [ ] Automated accessibility checks, interaction tests, and visual regression for supported themes
- [ ] Lint, format, types, tests, migrations, seed, and production build in CI

## Later

### Advanced reporting and analytics

- [ ] Operational dashboards for work mix, cycle time, authorization, technician productivity, parts,
      revenue, margin, receivables, and customer retention
- [ ] Governed metric definitions and tenant-safe analytical access
- [ ] Scheduled reports, exports, and multi-location/ownership-group rollups
- [ ] Custom report builder with field-level authorization and query limits
- [ ] Replaceable warehouse/export boundary for larger analytical workloads

### Payments and financing

- [ ] Payment-provider abstraction for card-present, card-not-present, ACH, refunds, disputes, and
      reconciliation
- [ ] Hosted-field or tokenized flows that minimize PCI scope
- [ ] Deposits, payment links, saved-method consent, and multi-location settlement reporting
- [ ] Financing-partner boundary for offers, applications, decisions, disclosures, status, and funding
- [ ] Provider outage behavior that never hides invoices or historical payments

### Warranty and service-history partners

- [ ] Warranty eligibility, coverage verification, claim submission, documentation, authorization,
      status, settlement, and reconciliation provider contracts
- [ ] Support for third-party, aftermarket, and manufacturer warranty workflows without coupling core
      work orders to one partner
- [ ] CARFAX service-history reporting with explicit organization configuration, customer/privacy
      controls, retryable delivery, and auditable acknowledgements
- [ ] Additional vehicle-history and maintenance-network providers through the same replaceable boundary

### Additional platform expansion

Scheduling, inspections, inventory, purchase orders, vendors, messaging, project builds, accounting,
vehicle and equipment data, parts and labor catalogs, customer/technician mobile applications, plugin
permissions, public API clients, webhooks, and workflow automation follow validated core operations.

New partner ideas should enter discovery first. A named integration is not committed until commercial
access, API capability, security, data rights, support burden, and customer demand are validated.
