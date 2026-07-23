# Localization and translation

ShopOS treats multilingual operation as a core platform capability. This has two separate concerns:

- **product localization** renders ShopOS-owned interface messages, formatting, navigation, validation,
  and documents in a supported locale
- **content translation** optionally translates tenant- or user-generated content through a
  policy-controlled provider

Product localization must remain deterministic and available without an external provider. Content
translation is replaceable, asynchronous where useful, and never becomes the source of truth.

## Core rules

- Use canonical BCP 47 locale identifiers such as `en-US`, `es-MX`, `fr-CA`, and `ar`.
- Keep UI locale, source-content language, target language, organization business locale, location time
  zone, currency, and unit system as distinct values.
- Changing locale changes presentation. It never changes stored money, tax, authorization, workflow
  state, identifiers, or UTC instants.
- Preserve the original content exactly. A translation is a derived, versioned projection.
- Existing records remain readable when translation is disabled, unavailable, unaffordable, or
  misconfigured.
- Machine-translated content is labeled and can be compared with the original.
- External providers never translate application chrome during a request.
- High-consequence content requires approved language or human review before presentation.

## Product localization

### Web implementation

The web application will use `next-intl` with ICU MessageFormat-compatible, checked-in catalogs. ICU
messages keep plural, select, number, date, and rich-text grammar together rather than assembling
sentences from fragments.

Human-facing web routes will carry an explicit locale segment such as `/en-US/...`. API and webhook
routes remain locale-neutral. A locale supplied to an API is presentation context only and grants no
authority.

Message catalogs are version-controlled product assets:

- English (`en-US`) is the initial source and final runtime fallback, not a hard-coded component
  language.
- Catalogs are organized by stable business namespace and loaded only for the current locale.
- CI rejects malformed ICU messages, placeholder mismatches, and missing required source messages.
- Exact locale falls back to an explicitly configured parent locale and then `en-US`.
- Missing production messages emit safe structured diagnostics without logging customer content.
- Provider-generated draft catalogs may assist translators, but reviewed catalogs must be committed
  before release.

Shared UI primitives receive accessible names and descriptions from their caller. ShopOS domain
compositions resolve their own message namespace. Feature routes must not create user-visible sentences
by concatenating translated fragments.

### Locale resolution

Authenticated UI locale uses this precedence:

1. an explicit locale change for the current membership
2. a membership-specific preference
3. the global user's preference
4. the organization's default among its enabled locales
5. a supported browser preference
6. ShopOS `en-US`

Customer-facing content uses:

1. an explicit language selection on the current authorized experience
2. the recipient/customer preferred locale
3. the locale sealed into a presented communication or authorization link
4. the organization/location customer-communication default
5. ShopOS `en-US`

A locale preference does not imply organization membership, record access, or permission.

### Formatting

Use `Intl` and shared formatting services for:

- dates and times using the record instant plus the authorized location's IANA time zone
- integer-minor-unit money using the record's ISO currency, never a locale-selected currency
- decimal quantities, percentages, lists, relative time, and display names
- units using stored canonical values and explicit conversion policy

Do not persist formatted values. Do not parse localized display strings back into authoritative money,
dates, or quantities without a typed locale-aware input boundary.

### Bidirectional and inclusive UI

- Set correct `lang` and `dir` at the document boundary.
- Use CSS logical properties and direction-aware layout primitives.
- Mirror directional navigation affordances selectively; do not mirror universal symbols or content.
- Wrap VINs, phone numbers, email addresses, part numbers, codes, and mixed-direction identifiers with
  `bdi` or an explicit safe direction.
- Test text expansion, truncation, wrapping, tables, forms, dialogs, calendars, charts, print, PDF,
  email, and customer authorization surfaces.
- Maintain expanded and RTL pseudo-locales in development and CI.
- Treat translated accessible names, descriptions, errors, and live-region announcements as product
  copy, not afterthoughts.

## Tenant and user settings

Localization configuration is stored in ShopOS:

- organization default and enabled UI locales
- organization/location customer-communication defaults
- user preference with an optional membership-specific override
- customer and contact preferred locale
- allowed translation modes and translatable field policy
- selected translation-provider binding
- approved target locales and background-translation rules
- privacy, data-residency, retention, budget, and review policy

Translation-provider credentials use encrypted values or external secret references. Configuration is
available at platform, organization, and, only when justified, location scope. It is administered in
the application rather than through one feature-specific environment variable.

## Content translation domain

### Ownership

The canonical domain module owns the source content and decides which fields are translatable. The
translation module stores derived results and job state. A translation record never authorizes access
to its source.

The first authorized query must validate the canonical source resource using the requesting actor's
organization and location context. Background workers carry a stable source reference, reload the
source under tenant context, and calculate its content hash before dispatch.

Do not place arbitrary serialized records or unrestricted source text in queue payloads. If a source
snapshot is operationally required, encrypt it, minimize it, and apply a short retention policy.

### Conceptual records

`OrganizationLocalizationSettings`

- organization, defaults, enabled locales, provider binding, automation, privacy, residency, retention,
  budget, and review policies

`LocalizationPreference`

- user default plus optional organization-membership override

`TranslationGlossary`

- organization, source/target locale pair, immutable version, lifecycle state, preferred translations,
  prohibited translations, and do-not-translate terms

`ContentTranslation`

- organization and optional location
- source resource type, identifier, field, and immutable source version/content hash
- source and target locale
- translated content
- generation state and review state
- provider binding, provider/model version when reported, glossary version, and provider request ID
- request, completion, review, staleness, and failure metadata

`TranslationJob`

- tenant context, source locator, target locale, requested mode, idempotency key, state, attempts,
  normalized failure, usage, and timing

Tenant-owned uniqueness includes organization, source locator, source hash, target locale, glossary
version, and translation policy/provider version. Changing the source marks older translations stale
without deleting their history.

### Permissions

Separate permissions cover:

- requesting a translation
- reading a translated projection
- reviewing or approving a translation
- managing glossaries
- configuring provider bindings and translation policy

Translation reads and mutations require the same or stronger source-record access. A location-limited
actor cannot request or retrieve translations for another location.

## Translation provider boundary

Core modules depend on a `TranslationProvider`, never a commercial SDK. Capabilities describe:

- supported locale pairs and source-language detection
- synchronous text, asynchronous/batch, HTML/tag, and document translation
- maximum request size and provider quotas
- glossary/custom terminology, context, formality, style, and custom-model support
- placeholder and markup preservation
- document formats
- regional processing, retention, and training-use characteristics
- usage/cost units, health, timeouts, normalized failures, and rate limits

A normalized text request includes explicit tenant context, source and target locale, approved content
type, optional glossary/configuration version, context, idempotency/correlation key, and field
classification. Results include translated content, detected locale, usage units, provider request ID,
model/version when reported, and warnings.

ShopOS may offer a global provider binding as a managed service or use an organization's own
connection. Provider fallback is explicit. Content is never silently sent to a second provider with
different residency, retention, training, cost, or contractual terms.

### Initial candidates

- **Google Cloud Translation Advanced**: text, batch, document translation, glossaries, custom models,
  IAM, labels, and regional controls
- **Azure Translator**: text and synchronous/asynchronous document translation, glossaries, custom
  models, and regional processing choices
- **Amazon Translate**: real-time and batch translation, custom terminology, formality, and
  AWS-native security/operations
- **DeepL API**: text and document translation, context, glossaries, formality, model selection, style,
  and translation-memory capabilities where supported

These are adapter candidates, not required services. Commercial/API access, supported language pairs,
privacy terms, retention, quality, rate limits, and total cost require discovery before implementation.

Meta's NLLB-200 is a model family, not a hosted provider. The published Meta model card describes it as
a noncommercial research model that is not released for production deployment and is not intended for
domain-specific, legal, or document translation. NLLB may inform evaluation of low-resource languages,
but it is not an eligible ShopOS production default without a separately suitable license, deployment,
quality, and safety assessment. Self-hosted or open-model adapters remain a capability class rather than
a commitment to NLLB.

Additional commercial providers, customer-operated endpoints, and commercially usable open models may
enter provider discovery as demand and language coverage require.

## On-demand and background workflows

### On demand

Use for occasional notes, descriptions, or customer assistance:

1. Authorize the source resource and field.
2. Resolve organization policy, provider, source locale, target locale, and glossary.
3. Check a tenant-scoped cache using source hash and policy/provider/glossary versions.
4. Return a labeled translation or a clear retryable state.
5. Preserve immediate access to the original when the provider fails.

On-demand translation may wait briefly for low-risk text, but it must not hold a financial transaction
or mutation open.

### Background

Use domain events and the tenant-aware job runner for configured pretranslation:

1. An allowed source field changes.
2. An outbox event references the tenant-scoped source and its version.
3. A worker reloads and authorizes the source.
4. The job deduplicates by organization, source hash, target locale, glossary, and policy version.
5. Transient failures retry with bounded backoff; permanent failures enter reconciliation.
6. Source changes mark prior results stale.
7. Only configured fields and target locales are translated.

Do not blanket-submit full customers, work orders, or message threads.

## Privacy, quality, and safety

- Classify and allowlist translatable fields.
- Never submit credentials, authentication data, payment details, raw government identifiers, secret
  notes, or unrestricted provider payloads.
- Minimize or redact personal/contact data not needed for the translation.
- Enforce the organization's provider, region, retention, consent, and budget policy before dispatch.
- Audit configuration, request, provider selection, review, publication, and failure without logging
  source or translated content.
- Record provider/model/glossary provenance and disclose machine translation to readers.
- Treat provider confidence as advisory; providers expose different or no quality measures.

### High-consequence content

Estimates, authorizations, invoices, warranty/legal terms, safety instructions, and compliance
disclosures use stricter controls:

- typed amounts, taxes, dates, units, identifiers, and workflow states are rendered from structured
  data and never translated as prose
- approved templates or human review are required before issue, signature, or consent
- the canonical source and exact presented translation are immutable snapshots
- presentation records locale, source version, translation version, glossary, reviewer, and provenance
- signatures and authorization bind to the canonical record and exact translation shown
- machine translation never silently changes legal meaning or workflow state

## Observability

Record tenant-safe metrics without content:

- requests, characters/units, latency, success/failure, and estimated cost
- cache hits, stale results, queue age, retries, and dead letters
- provider and locale-pair health
- language-detection disagreement
- catalog fallback and missing-message events
- review acceptance, rejection, and material edit rate
- high-consequence translations awaiting review

## Delivery order

1. Establish ICU catalogs, locale routing/negotiation, formatting helpers, `lang`/`dir`, pseudo-locales,
   and CI validation before additional product UI spreads.
2. Refactor the current foundation and design-system catalog to use localized messages and add
   expansion/RTL component tests.
3. Persist organization, location, user/membership, and customer locale preferences with server-side
   resolution.
4. Implement the translation domain, privacy field policy, deterministic test adapter, cache, stale
   state, permissions, and denial tests.
5. Select one production provider through discovery and translate low-risk UGC on demand.
6. Add background translation through the outbox/job runner.
7. Add glossaries, human review, approved reuse, and provider usage/cost controls.
8. Add further providers based on language coverage, customer deployment, and contractual needs.
9. Implement immutable multilingual presentation for estimates, authorization, invoices, and other
   high-consequence output.

## Provider references

- [Google Cloud Translation Advanced overview](https://docs.cloud.google.com/translate/docs/api-overview)
- [Azure document translation overview](https://learn.microsoft.com/en-us/azure/ai-services/translator/document-translation/latest/overview)
- [Amazon Translate custom terminology](https://docs.aws.amazon.com/translate/latest/dg/how-custom-terminology.html)
- [DeepL text translation API](https://developers.deepl.com/api-reference/translate/request-translation)
- [Meta NLLB-200 model card](https://huggingface.co/facebook/nllb-200-distilled-600M)
