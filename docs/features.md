# ShopOS feature tour

What you can actually run today. Everything listed here is implemented, tested, and exercised by
the seeded demo data (`pnpm db:seed`) — this document deliberately separates shipped behavior from
the [roadmap](roadmap.md). Where a capability depends on an external account (a payments provider,
a maps key), it degrades gracefully without one.

## Operations

- **Work orders** — repair, maintenance, and project work with a 10-state lifecycle
  (draft → estimating → awaiting authorization → authorized → in progress → completed → invoiced →
  closed, with blocked and cancelled branches), enforced server-side. Customer concern, optional or
  multiple assets, assignments with assisting technicians, shop stage, bay, and key tag.
- **Work board** — a kanban view of live work across your shop, with configurable board columns
  (beyond the built-in stages) per organization.
- **Tabbed work order screen** — one work order, six workflow tabs (Jobs & estimate, Parts,
  Work & time, Inspections & media, Money, Activity) under a collapsible header that always shows
  customer · vehicle · status and the money snapshot (estimate / authorized / balance).
- **Multi-RO workspace** — several repair orders open at once as tabs; the open set lives in the
  URL so a refresh restores exactly what you were looking at, and each RO keeps its scroll and
  panel state while you switch.
- **My day** and **schedule** — a personal view of assigned work and an appointment calendar with
  booking guards for holidays and shop hours.
- **Key board** — which key tag goes with which job, and where it lives right now; a card grid
  with one-tap location chips built for a wall-mounted tablet.
- **Declined work** — a follow-up queue of work the customer declined, so nothing gets lost.
- **Pickup & delivery / logistics** and **fleet** — shop-owned vehicles, loaner checkouts and
  reservations with registration/insurance expiry tracking.
- **Roadside dispatch** — mobile service calls (jumpstarts, tire changes, lockouts, mobile repair)
  with a status board (requested → dispatched → en route → on scene), tap-to-call customer phone,
  technician assignment, and one-tap geocoding/routing when a maps connector is configured.

## Estimating and authorization

- **Estimate revisions** — immutable once presented; corrections are new revisions or change
  orders, never silent edits (ADR 0004, ADR 0014).
- **Jobs on the estimate** — group lines into jobs (Front brakes: rotors + pads + labor; Tune up:
  plugs + wires + labor). Draft estimates have a drag-and-drop editor: slide lines between jobs,
  reorder jobs, rename inline. Grouped layout carries through to the customer authorization page
  and the printed estimate with per-job subtotals.
- **Option groups (good / better / best)** — offer alternatives for the same service (regular vs
  premium oil change). The customer picks one on the authorization page; the server enforces a
  single choice per group, auto-declines the alternatives, and only the chosen option reaches the
  invoice.
- **Authorization** — line-level approve/decline, expiring revocable customer links
  (email or SMS), staff-recorded decisions, and printable authorization documents. Choosing an
  option records the whole decision unambiguously.
- **Canned jobs** — reusable service templates applied to an estimate in one click.
- **Cash discounting-ready pricing** with named tax rates, stacked taxes (e.g. GST + PST/QST), and
  VAT-inclusive or exclusive display per organization.

## Digital vehicle inspections

- Inspection templates with per-item conditions (ok / watch / replace / n/a), notes, and media.
- Photos and video evidence attached to inspection items and estimate lines — video via Mux or
  local storage, photos via the storage connector.
- Inspection recommendations flow into estimates with their evidence attached.
- A signed customer tracker link so the customer can watch job progress without an account, plus
  a full customer portal.

## Parts and inventory

- Suppliers, part orders with purpose tracking (job-specific vs stock replenishment vs
  allocation), partial and full receiving with confirmation-guarded receive-all, and a
  waiting-on-vendors board.
- Inventory depth for auto parts: OE numbers, per-manufacturer aftermarket numbers, interchange
  lookup, categories, conditions (new/used/refurb), cores, consumables, unit-of-measure groups
  (quarts/gallons/drums) with base-unit totals, bin locations, photos, and per-item purchase
  history ("last bought 4 qt from NAPA on…").
- Reorder points with low-stock surfacing and reorder suggestions.
- Sublet work tracked alongside parts on the work order.

## Billing and payments

- **Invoices** — immutable snapshots from completed work, per-establishment invoice series and
  legal numbering, tax IDs on prints, and void/reissue semantics.
- **Payments your way (BYO)** — connect your own account: Stripe, Square, Adyen, Mollie,
  Mercado Pago, or Razorpay. Payment links (shareable URLs with signed webhooks), in-app
  processor charges, split/mixed tender, refunds, and deposits taken before invoicing.
  Manual methods — cash, check, and record-only cards — always work without any processor.
  Zero-decimal currencies (CLP, COP, JPY) handled correctly.
- **Cash drawer** — count-in/count-out sessions with expected vs counted reconciliation and
  per-user attribution.
- **Accounts receivable** — open balances by customer with aging buckets, printable statements,
  and account customers (statement billing) vs pay-at-pickup.

## International

- Regional settings per organization with location overrides: currency, locale, phone country,
  cash rounding, week start.
- Tax identity: org and customer tax IDs, VAT-inclusive/exclusive document snapshots, stacked
  taxes with per-component rounding.
- E-invoicing formats — Factur-X/ZUGFeRD (CII), XRechnung (UBL), FatturaPA — generated as
  tamper-evident snapshots; clearance adapters (SDI, KSeF, IRP, VeriFactU) are connector slots
  for regional intermediaries.
- E.164 phone parsing with country defaults, holiday calendars per location, and country-aware
  address shapes in the customer forms.

## Connectors (ADR 0008)

Every external dependency sits behind a provider interface with encrypted credentials — the
platform never requires a specific vendor to read your data:

- **Payments:** Stripe, Square, Adyen, Mollie, Mercado Pago, Razorpay
- **Maps:** Google Maps, Azure Maps, Mapbox, AWS Location
- **Video:** Mux or local storage
- **Storage:** S3-compatible object storage
- **E-invoicing:** format builders plus clearance slots for regional intermediaries
- **Email/SMS:** console adapter in development; bring-your-own provider in production

## Platform

- **Multi-tenant from the first query** — every business record carries its organization; roles,
  location-scoped access, and membership are rebuilt server-side on every request. Cross-tenant
  denial paths are integration-tested, not assumed.
- **Better Auth** — email/password, magic link, email OTP, MFA, passkeys, recovery.
- **SaaS control plane** — a separate security plane (`/platform`) for operators: plans,
  entitlements, organization lifecycle, audit history, MFA-gated.
- **Theming** — organizations choose light/dark/dusk/warm themes with live preview; density
  (comfortable/compact) follows the user.
- **Accessibility** — keyboard, focus, screen-reader, contrast, reduced-motion, and touch-target
  standards are part of feature acceptance, with an a11y structure test in the suite.

## Not yet implemented

Kept honest per the working agreements — the schema and module boundaries prepare for these but
they are not shipped behavior:

- SSO / SAML / OIDC federation for customer organizations (policy module exists; sign-in flow pending)
- Production email delivery adapters (console adapter in dev; safe null adapter in prod)
- Native mobile apps (ADR 0013) — the web UI is touch-first for tablets
- Support access / impersonation (deliberately awaiting its own threat model)
- Full locale-prefixed routing and ICU catalogs for the UI itself
- License selection (governance task for the initial release)
