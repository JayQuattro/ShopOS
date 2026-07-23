# ADR 0010: Localization and content translation are core, separate boundaries

- Status: Accepted
- Date: 2026-07-23

## Context

ShopOS will serve staff and customers across languages, regions, scripts, and deployment models.
Retrofitting localization after feature copy, routes, components, templates, and stored content spread
would make language support inconsistent and expensive.

Two problems are easily conflated:

1. ShopOS-owned application messages and locale-sensitive formatting must be deterministic, reviewed,
   accessible, and available without a network provider.
2. Tenant- or user-generated content may benefit from optional machine translation with different
   privacy, quality, cost, latency, review, and provider requirements.

Translation vendors expose different language pairs, glossaries, batch/document support, models,
regional controls, retention terms, and rate limits. Some model releases are research-only or carry
licenses unsuitable for commercial SaaS.

## Decision

### Product localization

- Use BCP 47 locale identifiers.
- Use `next-intl` and ICU MessageFormat-compatible, checked-in catalogs for the web application.
- Prefix human-facing web routes with an explicit locale; keep APIs locale-neutral.
- Use an explicit locale fallback chain ending in `en-US`.
- Use shared `Intl`-based formatters for dates, time, numbers, money, units, lists, and plurals.
- Set `lang` and `dir` at the document boundary and require logical layout, pseudo-locales, RTL, text
  expansion, and mixed-direction identifier testing.
- Never call an external translation provider to render normal application chrome.

### Content translation

- Create separate `localization`, `translation`, and provider-adapter responsibilities.
- Preserve canonical source content; translations are derived, versioned projections keyed by tenant,
  source version/hash, locale, glossary, and provider/policy version.
- Authorize the canonical source before requesting or reading a translation.
- Support on-demand and tenant-aware background translation without making a provider required to read
  existing data.
- Put translation vendors and customer/self-hosted endpoints behind capability-aware provider
  contracts.
- Configure global and organization provider bindings in ShopOS using encrypted values or external
  secret references. Fallback between providers is explicit and policy-compatible.
- Allowlist translatable fields and enforce privacy, data-residency, retention, budget, and consent
  policy before dispatch.
- Label machine output, preserve the original, record provenance, and support glossary and human-review
  workflows.
- Require approved language or human review plus immutable presentation provenance for estimates,
  authorizations, invoices, warranty/legal terms, safety instructions, and compliance disclosures.

Meta NLLB is treated as a model-evaluation candidate, not a production provider commitment. Any
self-hosted model requires a commercial-license, deployment, quality, privacy, safety, and support
assessment.

## Consequences

- Localization infrastructure and copy extraction move ahead of further UI composition work.
- Current hard-coded bootstrap/design-system messages are temporary and must be migrated through the
  locale foundation issue.
- Organization, membership/user, customer, and communication models will carry explicit locale
  preferences.
- Translation jobs, caches, results, and glossaries become tenant-owned, auditable data.
- Application and provider catalogs have different release and review lifecycles.
- UI tests expand to include pseudo-locales, RTL, locale formatting, long text, and mixed-direction
  content.
- Provider adapters can add capabilities without leaking vendor types into domain modules.
- Machine translation can improve access while never silently becoming authoritative business,
  financial, legal, or safety content.

## Rejected alternatives

### Translate only after the English product is complete

Rejected because routes, copy composition, layout assumptions, documents, and data models would already
encode English-only behavior.

### Use a translation API for application messages at runtime

Rejected because normal navigation would become nondeterministic, provider-dependent, slower, more
expensive, and harder to review or audit.

### Store translated UGC beside every source field

Rejected because it duplicates provider, locale, version, stale-state, provenance, and review behavior
across domains.

### Treat translations as replacements for source content

Rejected because machine output cannot safely overwrite the author's canonical record or immutable
presented history.

### Standardize on one translation vendor

Rejected because organizations have different cloud commitments, language needs, residency policies,
credentials, pricing, and quality requirements.
