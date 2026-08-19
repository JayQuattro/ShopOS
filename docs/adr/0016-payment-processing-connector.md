# ADR 0016: Payment processing connector (bring-your-own, organization-scoped)

Date: 2026-08-22

## Status

Accepted

## Context

Shops collect money in many ways — card terminals, hosted payment links, wallets
(Apple Pay, Alipay, WeChat Pay), checks, cash, and region-specific rails (Zelle,
iDEAL, and what Adyen/Worldpay/Chase expose). Manual payment recording exists
today, but there is no way to request money electronically or to reconcile
automatically. The integration strategy (ADR 0008) already establishes
connector families with provider adapters; email, storage, SMS, and maps use it.

Two ownership models exist for processors:

1. **Platform-managed processing** (e.g. Stripe Connect): the platform's account
   processes every organization's money and remits payouts. The platform becomes
   a money transmitter, takes on KYC/AML and payout operations, and self-hosted
   deployments cannot use it.
2. **Bring-your-own (BYO)**: each organization connects its own processor
   account. Money flows directly from the customer to the shop. Self-hosted and
   SaaS deployments behave identically.

## Decision

Payment processing is a connector capability `payments` with **BYO,
organization-scoped** configuration in v1.

- `ConnectorInstance` rows are created with `scope: "organization"` and
  `organizationId` set; encrypted secrets (Stripe secret key, webhook signing
  secret) live in the existing envelope-encrypted secret column.
- The resolver intentionally has **no platform fallback**: a platform-scoped
  payments connector would mean the platform processes tenant money. If a
  managed/Connect offering is added later, it will be a new scope decision in
  this ADR, not a silent fallback.
- Dev/test resolves a deterministic `console` adapter so the payment-link flow
  is demonstrable without provider credentials.

### Adapter interface (v1)

`createPaymentLink({ amountMinor, currency, description, reference, returnUrl })`
returns `{ url, providerRef }`. The link is attached to an issued invoice; the
balance due is requested, never the full total, so partial payments keep AR
truthful. Invoice columns `payment_url` and `payment_link_ref` store the
projection; the invoice remains the source of truth for amounts.

Signed webhooks (adapter-verified, per-provider schemes) will confirm payment
and record it through the same path as manual recording, keyed idempotently by
the provider reference.

### Provider landscape

Live adapters: **Stripe**, **Square** (the brick-and-mortar default), **Adyen**
(Pay by Link), **Mollie** (the EU default). Planned slots are registered in the
definitions registry as `status: "planned"` and shown as coming-soon in
settings — honest about implemented vs. planned, and shops can tell us which
slot they need: **PayPal/Venmo**, **Heartland/Global Payments (Dealer Tender —
the automotive-vertical incumbent)**, **Worldpay/Fiserv**, **Chase Merchant
Services**, **Authorize.Net**, **GoCardless** (bank debit), **Elavon/Converge**,
**Moneris** (Canada), **Razorpay** (India), **Mercado Pago** (LatAm/PIX), and
**Clover**.

Wallets and regional rails ride the processor (Apple Pay / Alipay / WeChat Pay
are Stripe/Adyen payment methods, not separate ShopOS connectors). Cash, check,
Zelle-style bank rails, and cash-discounting are domestic ShopOS pricing/payment
features, not connector concerns. Webhook auto-confirmation beyond Stripe is a
follow-up per adapter; Square/Adyen/Mollie links record payments manually until
their webhook verification lands.

### Out of scope for v1 (documented follow-ups)

- Terminal integration (fixed and mobile, iOS/Android tap-to-pay) — native app
  work per ADR 0013 plus device registration; interface will grow
  `createTerminalCharge` alongside `createPaymentLink`.
- PayPal as a first-class adapter, card-on-file, refunds/voids, processor
  settlement reconciliation in the cash drawer close-out.
- Platform-managed (Connect) processing for the SaaS offering.

## Consequences

- A shop with no processor configured loses nothing they have today; payment
  links simply do not appear.
- Org-scoped secrets need the same encryption-key discipline as other
  connectors (`CONNECTOR_ENCRYPTION_KEY`).
- Webhook endpoints must resolve the organization from the URL path and verify
  signatures with that organization's stored secret before trusting anything in
  the payload; no tenant context exists for external processors, so automated
  payments are audit-logged with the provider reference as their provenance.
