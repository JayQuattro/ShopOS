# Integration strategy

ShopOS treats integrations as a product platform with replaceable adapters, not as provider-specific
logic scattered through business modules. Core modules depend on capability interfaces and normalized
results. They never depend directly on a commercial SDK.

Named providers in this document are examples and discovery targets, not delivery commitments.

## Configuration model

An integration is separated into four concepts:

- **Adapter definition**: code-shipped metadata and implementation for a provider. It declares its
  capabilities, supported connection modes, directionality, configuration schema, health checks,
  normalized errors, rate-limit behavior, idempotency behavior, webhook verification, and compatible
  ShopOS versions.
- **Connector instance**: one configured connection to an adapter, such as a ShopOS-managed Amazon SES
  account, an organization's Microsoft 365 tenant, or a location's S3-compatible bucket.
- **Connector assignment**: a policy selecting a connector instance for a capability, organization,
  and optional location. It records priority, allowed operations, fallback behavior, and whether using
  a platform-managed service is permitted.
- **Secret reference**: an opaque reference to encrypted credentials or an external secret store.
  Business configuration and secret metadata are persisted separately from raw secret values.

Connector instances may have one of these scopes:

- `PLATFORM`: operated by the ShopOS installation and optionally offered to organizations as a service
- `ORGANIZATION`: available only inside one organization
- `LOCATION`: an organization-owned override available only to one location

A platform-scoped instance does not automatically authorize every organization to use it. Each
organization needs an explicit assignment, entitlement, sender identity or storage namespace, consent
where applicable, quotas, and auditable terms. Organization- and location-scoped credentials never
fall back to another tenant's connector.

Resolution starts with an explicit location assignment, then an organization assignment, and finally
an explicitly enabled platform service. A missing, disabled, unhealthy, or unauthorized connector
returns a capability-unavailable result unless the assignment declares a safe fallback. Routing never
guesses based on whichever credentials happen to exist.

## In-application administration

Provider selection, routing, non-secret configuration, organization access, and lifecycle state are
database-backed and configurable through authorized ShopOS administration workflows. They are not
deployment environment variables.

Configuration changes are schema-validated, versioned where operational behavior changes, and written
to the audit trail. Connector lifecycle states include draft, active, degraded, reauthorization
required, and disabled. A connection-test action must distinguish credential validity, provider health,
and ShopOS configuration errors without exposing secrets.

Raw credentials use envelope encryption or an external secret manager. The database stores ciphertext
or a secret reference, key version, credential type, timestamps, and masked display metadata. Secret
values are write-only in the application, excluded from logs and audit payloads, rotatable without
changing business records, and deleted according to an explicit revocation workflow.

Only minimal installation bootstrap material—such as the root wrapping-key reference or connection to
the selected secret manager—may come from the deployment secret mechanism. Provider configuration,
organization selection, and normal credential rotation remain in-application concerns.

## Adapter contract

Every adapter declares:

- stable capability names and whether they are inbound, outbound, or bidirectional
- supported authentication and ownership modes, including OAuth, API keys, service accounts, and
  platform-managed credentials
- a versioned configuration schema suitable for generating safe administration forms
- validation, connection testing, health, timeout, retry, rate-limit, and circuit-breaker behavior
- idempotency keys, external identifier namespacing, and reconciliation support
- webhook signature verification, replay protection, delivery acknowledgement, and backfill behavior
- data classification, retention, residency, consent, and provider terms that affect use
- normalized errors that distinguish retryable, reauthorization, configuration, quota, and permanent
  failures

Provider SDKs remain inside adapter packages. Domain modules call application-level capabilities such
as `message.send`, `calendar.event.publish`, `file.store`, `payment.capture`, or
`vehicle.identity.resolve`.

## Capability families

| Family                  | Initial adapter candidates                                                                                      | Important distinctions                                                                                                                                                                                       |
| ----------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Email                   | SMTP, Amazon SES, Mailgun, Resend, SendGrid, Google Workspace, Microsoft 365, IMAP                              | Transactional send, inbound mail, mailbox sync, threading, sender verification, suppression, and delivery events are separate capabilities. SMTP is outbound only; IMAP is inbound only.                     |
| SMS and telephony       | Twilio, AWS messaging/telephony services, Azure Communication Services, additional regional providers           | SMS, MMS, voice, number ownership, call events, recording consent, emergency-use exclusions, and regional compliance must be explicit.                                                                       |
| Storage                 | Amazon S3, S3-compatible providers with tested presets, Google Cloud Storage, Azure Blob Storage, Cloudflare R2 | Object storage, signed access, retention, malware scanning, residency, lifecycle, and customer-managed buckets are separate concerns.                                                                        |
| Mapping and location    | Google Maps Platform, Mapbox, OpenStreetMap-based services, Azure Maps, AWS location services                   | Geocoding, address validation, autocomplete, maps, routing, licensing, attribution, caching, and usage limits vary independently.                                                                            |
| Electronic signature    | To be validated                                                                                                 | E-signature is not interchangeable with ShopOS estimate authorization. Identity evidence, document integrity, certificates, legal jurisdiction, retention, and webhook status require a separate capability. |
| Calendar and scheduling | Built-in ShopOS scheduling, Google Calendar, Microsoft Outlook Calendar, iCalendar import/export                | Publishing, bidirectional sync, free/busy, attendees, recurrence, conflict handling, ownership, and loop prevention require explicit modes.                                                                  |
| Payments and financing  | Replaceable payment and financing providers                                                                     | Tokenization, PCI scope, settlement ownership, refunds, disputes, reconciliation, disclosures, and provider-independent history are mandatory design inputs.                                                 |
| Accounting              | QuickBooks Online, Xero, additional accounting platforms                                                        | Export-only versus bidirectional sync, chart-of-accounts mapping, tax handling, contacts, invoices, payments, reconciliation, and period locking must be configurable.                                       |
| Marketing and web       | To be validated                                                                                                 | Consent, audience membership, suppression, attribution, forms, webhooks, and deletion propagation must precede named-provider commitments.                                                                   |
| Automotive identity     | VIN decoding, VIN lookup, license-plate lookup, registration and vehicle-data providers                         | Data provenance, region, permitted use, confidence, caching, customer consent, and manual override are required.                                                                                             |
| Repair information      | MOTOR, ALLDATA, and other licensed repair-guide, diagram, procedure, specification, and labor-time providers    | Entitlements, technician access, deep links versus licensed content storage, vehicle matching, versioning, and attribution vary by contract.                                                                 |
| Parts ordering          | Nexpart, AutoZone, Advance Auto Parts, WORLDPAC, NAPA, RepairLink, and other suppliers/networks                 | Availability, fitment, pricing, account terms, ordering, substitutions, returns, cores, shipping, status, and reconciliation are distinct capabilities.                                                      |
| Content translation     | Google Cloud Translation, Azure Translator, Amazon Translate, DeepL, and validated self-hosted models           | Locale pairs, glossary support, content class, privacy, residency, retention/training terms, review state, provenance, cost, and asynchronous operation must be explicit.                                    |

Presets for common S3-compatible and similar providers supply known endpoints and defaults; they do not
bypass capability probing, TLS validation, credential isolation, or organization ownership checks.

## Tenant isolation and authorization

Integration administration uses explicit capabilities such as `integrations.platform.manage`,
`integrations.organization.manage`, `integrations.location.manage`, and capability-specific operational
permissions. A platform operator cannot silently expose one organization's connector to another.

Every invocation carries organization context and, where applicable, location context. External IDs,
idempotency keys, cached data, inbound messages, webhook endpoints, and reconciliation records are
namespaced by connector instance and organization. Inbound requests resolve an opaque endpoint to one
connector before accepting provider identifiers; provider-supplied organization IDs are never trusted
as ShopOS authority.

Audit history records configuration, assignment, activation, reauthorization, secret rotation,
connection tests, manual retries, and destructive disconnection actions without recording raw secrets
or unrestricted provider payloads.

## Domain events, jobs, and webhooks

Meaningful lifecycle events—such as `estimate.presented`, `authorization.recorded`,
`work_order.completed`, and `invoice.issued`—are recorded in the same transaction as state changes. A
database-backed outbox dispatches outbound integration jobs with tenant context, stable identifiers,
connector assignment, retry policy, and idempotency keys.

Inbound webhooks are signature-verified, replay-protected, stored in a bounded form where necessary,
and processed asynchronously. Delivery attempts and reconciliation state are operational records, not
the source of truth for core ShopOS invoices, payments, work orders, or files.

## Translation integrations

Product UI localization uses checked-in ICU catalogs and never depends on a translation provider at
runtime. Tenant/user-generated content may use a capability-aware `TranslationProvider` for text,
batch, HTML, or document translation.

Provider capabilities describe locale pairs, detection, request limits, glossary/terminology, context,
formality/style, markup preservation, custom models, regional processing, retention/training
characteristics, usage units, and asynchronous behavior. Google Cloud Translation, Azure Translator,
Amazon Translate, and DeepL are initial discovery candidates. A self-hosted model is a separate
deployment and licensing class, not an assumed equivalent to a hosted provider.

Translation bindings may be global managed-service connections or organization-owned connections.
Fallback is explicit; ShopOS never silently sends content to a provider with different privacy,
residency, contractual, or cost terms. Source records remain readable and authoritative during every
provider failure.

The complete policy, data, review, and high-consequence rules are in
[Localization and translation](localization-and-translation.md).

## Failure behavior

An unavailable provider may delay a new delivery, synchronization, order, enrichment, or payment
action, but must not prevent authorized users from opening existing shop records. Circuit breakers and
health state prevent repeated provider failure from exhausting workers. Disabling or replacing a
connector preserves provider-independent history and exposes unresolved reconciliation work.

Fallbacks must be capability-compatible and explicitly allowed by the assignment. ShopOS does not
silently send through a platform email account, move files to another region, submit an order to a
different supplier, or change payment processors merely because the configured connector is unhealthy.

## Identity integrations

Better Auth remains the authentication framework and protocol boundary for Microsoft, Google, OIDC, and
SAML sign-in. Identity-provider records use the same principles for encrypted credentials,
organization binding, in-application administration, health, audit, and reauthorization, while ShopOS
membership and location access remain authoritative.

SCIM is a later directory-provisioning extension. The application must not depend on Better Auth's
hosted infrastructure dashboard to remain functional. The Admin plugin and impersonation remain
excluded until platform support access has a separate audited design.

## Future extensions

A future third-party plugin manifest may declare identity, version, compatible ShopOS versions,
requested permissions, configuration schema, event subscriptions, provider capabilities, and UI
extension points. The first implementation uses reviewed, code-shipped adapters; it does not load
unrestricted tenant-supplied code into the ShopOS process.
