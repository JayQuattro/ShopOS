# Integration strategy

Core modules depend on provider interfaces, never directly on a commercial SDK.

Initial provider boundaries:

- file storage
- email
- SMS
- payments
- vehicle/equipment data
- parts and labor data
- accounting export
- content translation
- identity providers
- push notifications

Each provider declares capabilities, configuration validation, health behavior, normalized errors,
timeouts, and idempotency expectations. Provider credentials are read from environment or a secrets
adapter and are never stored in logs.

## Domain events and outbox

Meaningful lifecycle events—such as `estimate.presented`, `authorization.recorded`,
`work_order.completed`, and `invoice.issued`—are recorded in the same transaction as state changes. A
future outbox dispatcher delivers them to jobs, integrations, and webhooks with retry and idempotency.
Events carry organization context and stable identifiers, not unrestricted record dumps.

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

An unavailable provider may delay a new delivery or enrichment action, but must not prevent authorized
users from opening existing shop records. External identifiers and provider payloads are retained only
where operationally necessary and are isolated from core state.

## Identity integrations

Better Auth is the authentication framework and uses its official Prisma adapter. Built-in
organization, two-factor, compromised-password, and optional CAPTCHA plugins are planned alongside the
official passkey and SSO packages.

Platform-wide Google and Microsoft providers are optional environment configuration. Organization SSO
providers are database records bound to one organization. Provider secrets require application-level
encryption or an external secret reference before self-service SSO administration is enabled; the raw
SSO configuration must not be written to audit logs.

SCIM is a later directory-provisioning extension. The application must not depend on Better Auth's
hosted infrastructure dashboard to remain functional. The Admin plugin and impersonation are excluded
from the initial configuration because platform support access requires a separate, audited design.

## Future extensions

A future plugin manifest may declare identity, version, compatible ShopOS versions, requested
permissions, configuration schema, event subscriptions, provider capabilities, and UI extension points.
No unrestricted code-loading runtime is part of the bootstrap.
