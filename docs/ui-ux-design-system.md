# UI, UX, and design system

ShopOS should make everyday work feel obvious and complex work feel controlled. The interface serves
owners, service advisors, technicians, parts staff, bookkeepers, customers, and administrators with
different levels of technical comfort. A feature is not complete merely because its controls are
present; people must be able to understand the current state, choose a safe next action, recover from
mistakes, and verify the result.

## Experience principles

### Start with the job

Screens are organized around recognizable shop tasks and records, not database structures. Navigation,
page titles, primary actions, and empty states use the canonical domain language while allowing
configured industry presentation terms such as Vehicle or Repair Order.

### Make the next action clear

Each page has one visually dominant primary action for the current context. Secondary actions are
available without competing for attention. Disabled actions explain what is missing; permissions,
workflow state, and validation failures do not disappear behind unexplained disabled controls.

### Reveal complexity progressively

Common cases stay short. Advanced pricing, tax, routing, integration, and authorization controls appear
when their context makes them relevant. Progressive disclosure must not hide material totals,
commitments, permission effects, or irreversible outcomes.

### Preserve context

People should not lose their place while checking a customer, asset, estimate, part, or invoice.
Drawers, split views, breadcrumbs, recent records, and return links may preserve task context when they
remain accessible and responsive. The browser back button and meaningful URLs continue to work.

### Prefer safe reversibility

Drafts autosave where practical. Reversible actions offer undo or a clear correction path.
Irreversible, externally visible, financial, authorization, and destructive actions use an explicit
review step that names the record, scope, totals, recipients, and consequences.

### Explain the system in plain language

Labels describe business outcomes. Errors identify what happened, what remains safe, and how to
recover. Technical provider codes and internal identifiers may be available in diagnostic details but
are not the primary message.

### Support novices and experts together

Clear defaults and visible actions support infrequent users. Keyboard shortcuts, command search, bulk
actions, saved views, compact density, and predictable focus support high-volume users without changing
the underlying workflow rules.

## Default design direction

The default visual language is inspired by the restraint and editorial clarity of
[Anthropic's public site](https://www.anthropic.com/), not by copying its brand:

- warm neutral surfaces rather than sterile blue-gray dashboards
- dark ink, quiet borders, and a restrained clay/coral accent
- strong typographic hierarchy and generous space
- confident headings paired with highly legible interface text
- low visual noise, limited elevation, and purposeful motion
- content and task state carrying more emphasis than decorative chrome

ShopOS remains an operational application. Dense work lists, forms, status, and financial comparisons
need more structure than a marketing site. Editorial warmth should make the product approachable
without reducing scan speed or information clarity.

## Information architecture and application shell

The authenticated application uses a consistent responsive shell:

- a primary sidebar for major work areas
- an explicit organization and location context switcher
- global search and command access
- a page header containing record identity, state, breadcrumbs, and the primary action
- contextual tabs or local navigation for one record
- a utility area for notifications, help, account, and appearance preferences

Navigation is role-aware but not surprising. Lack of permission removes or disables actions without
changing canonical URLs or leaking protected counts. Users who participate in multiple organizations
must always see their current organization and location before committing sensitive work.

On narrow screens, the same hierarchy becomes a compact header, drawer or sheet navigation, and
task-focused content. Mobile layouts may reorder presentation but cannot hide financial totals,
authorization state, safety warnings, or required fields.

## Standard interaction patterns

### Records and lists

- Search, filters, sorting, saved views, pagination, and bulk selection share consistent placement.
- Tables support keyboard navigation and preserve meaningful headings, units, currency, and status.
- Narrow layouts use deliberate card/list representations or controlled horizontal access rather than
  silently dropping columns.
- Empty states explain why the list is empty and offer the next permitted action.

### Forms

- Labels remain visible; placeholders are examples, not labels.
- Validation runs near the field and again on the server.
- Unsaved, saving, saved, and failed states are explicit.
- Long forms use logical sections and a visible completion summary, not arbitrary wizard steps.
- Defaults are tenant-appropriate, observable, and easy to change before commitment.

### Feedback

- Inline feedback carries errors and durable warnings.
- Toasts acknowledge non-critical, already-completed actions; they are not the only place an error,
  identifier, total, or next step appears.
- Loading, empty, partial, degraded, permission-denied, offline, and provider-failure states are
  designed for each reusable pattern.
- Background actions expose status, retry, cancellation rules, and reconciliation rather than showing
  indefinite spinners.

### Destructive and high-consequence actions

Confirmation dialogs are reserved for meaningful consequences. They state the affected customer,
asset, organization/location, money, recipients, external delivery, and whether the result is
reversible. Destructive actions are not positioned beside common primary actions without separation.

## Complex workflow pattern

Estimates, authorizations, invoices, payments, connector setup, imports, and bulk changes use a shared
task pattern:

1. **Orient**: show purpose, tenant/location, record, current state, and prerequisites.
2. **Configure**: collect only information required for the selected path, revealing advanced options
   when needed.
3. **Validate**: surface field, relationship, permission, and provider problems without discarding
   entered work.
4. **Review**: summarize material changes, totals, recipients, external effects, and warnings in plain
   language.
5. **Commit**: use an outcome-specific action label such as “Issue invoice” rather than “Submit.”
6. **Confirm and recover**: show the resulting state, identifiers, remaining work, and available
   correction, retry, or reconciliation paths.

The pattern may appear on one page, in a drawer, or across a short staged flow. Step count alone does
not make a workflow understandable. People must be able to move backward before commitment without
losing valid input.

## Component strategy

Use [shadcn/ui](https://ui.shadcn.com/docs/components) for most foundational components because the
source is owned inside the repository and can be adapted to ShopOS. shadcn is a starting point, not a
substitute for product interaction design or accessibility review.

- Foundational primitives live in `src/components/ui`.
- ShopOS compositions such as MoneyField, TenantContextSwitcher, RecordHeader, WorkStatus,
  EstimateSummary, AuthorizationReview, and ProviderConnectionCard live in
  `src/components/shopos`.
- Feature modules compose these components rather than forking local button, field, dialog, table, or
  status implementations.
- Components expose semantic variants such as primary, secondary, destructive, warning, success, and
  financial emphasis rather than provider- or page-specific colors.
- A component catalog documents supported states, content guidance, keyboard behavior, responsive
  behavior, and accessibility expectations.

Prefer shadcn components where they fit. A custom component is appropriate when the business
interaction is genuinely different, but it should still reuse shared primitives and tokens.

## Theme architecture

Follow shadcn's recommended
[semantic CSS-variable theming](https://ui.shadcn.com/docs/theming). Components consume purpose-based
tokens such as background, foreground, card, primary, muted, accent, destructive, border, input, ring,
sidebar, and chart colors. They do not consume organization hex values directly.

Use OKLCH token values where supported so perceptual lightness and contrast can be controlled across
theme variants. Color is never the only carrier of status or meaning.

### Initial presets

- **Light**: warm paper and soft white surfaces, dark ink, quiet taupe borders, and restrained
  clay/coral emphasis
- **Dark**: charcoal and near-black surfaces, warm off-white text, low-glare borders, and controlled
  amber/coral emphasis
- **Warm**: sand, cream, umber, olive-neutral support, and terracotta emphasis
- **Dusk**: deep slate/indigo and muted plum surfaces with warm rose or amber emphasis
- **System**: follows the operating-system light/dark preference using the compatible organization
  theme pair

Every preset includes complete light/dark-safe semantic tokens, charts, focus rings, sidebars, data
states, and print behavior. Presets are versioned product assets rather than disconnected CSS files.

### Configuration layers

Theme resolution is deterministic:

1. protected ShopOS semantic and accessibility constraints
2. ShopOS default preset
3. the organization's published theme and allowed preferences
4. the user's permitted mode, preset, and density preference
5. operating-system reduced-motion, contrast, and color-scheme preferences

Organizations may select a preset and safely customize approved brand tokens, logo assets, neutral and
accent families, radius style, and comfortable/compact density defaults. Individual users may choose
from organization-allowed presets, system/light/dark behavior, and density unless policy requires a
fixed customer-facing brand.

Arbitrary CSS and arbitrary component markup are not accepted. Functional colors for destructive,
warning, success, authorization, invoice, and payment states are protected or constrained. Theme
publishing validates contrast and token completeness, provides representative previews, is versioned
and auditable, and supports rollback.

Theme configuration is persisted and administered in ShopOS, not through deployment environment
variables. Server rendering resolves enough theme state to avoid a flash of an incorrect theme while
remaining safe when user preferences are unavailable.

## Accessibility and inclusive design

Target [WCAG 2.2 Level AA](https://www.w3.org/WAI/standards-guidelines/wcag/) for supported workflows.
Accessibility is a component and feature acceptance criterion, not only a final audit.

- full keyboard operation and visible focus
- meaningful landmarks, headings, names, descriptions, and error association
- contrast validation for every published theme
- zoom, text reflow, reduced motion, and high-contrast consideration
- appropriately sized and separated touch targets
- no meaning conveyed by color, position, hover, or motion alone
- screen-reader announcements for meaningful async state changes
- accessible charts with summaries and table alternatives

Automated checks, lint rules, component tests, browser tests, and visual regression reduce common
failures. Manual keyboard, screen-reader, zoom, and real-device review remains required.

## Localization and bidirectional design

ShopOS-owned interface messages come from ICU catalogs; components do not embed English-only labels or
assemble sentences from translated fragments. Shared primitives receive localized accessible names
from their caller, while domain compositions resolve a stable business-message namespace.

- Design against realistic long translations and an expanded pseudo-locale.
- Use logical inline/block properties instead of assuming left and right.
- Set `lang` and `dir` at the document boundary and test an RTL pseudo-locale.
- Preserve readable wrapping for actions, status, errors, tabs, tables, money, dates, and identifiers.
- Isolate VINs, part numbers, phone numbers, email addresses, and codes in mixed-direction content.
- Treat locale switching as a context-preserving preference change, never an authorization change.
- Clearly distinguish machine-translated user content from the original and expose stale, pending,
  failed, and human-reviewed states.

High-consequence translations follow the normal review pattern plus exact source/translation version,
locale, provenance, and human-approval requirements. See
[Localization and translation](localization-and-translation.md).

## Research and measurement

Test representative workflows with shop owners, service advisors, technicians, parts staff,
bookkeepers, and customers. Early prototypes should cover organization onboarding, customer/asset
lookup, work-order creation, estimate review, authorization, invoice/payment, schedule changes, and
connector setup.

Track task completion, time to completion, validation and reversal frequency, abandoned drafts,
support requests, and qualitative confidence. Analytics must be privacy-conscious and tenant-safe.
Metrics identify friction; they do not replace observation and interviews.

## Delivery sequence

1. Establish Tailwind/shadcn, semantic tokens, typography, spacing, elevation, motion, and component
   ownership rules.
2. Implement Light, Dark, Warm, Dusk, and System presets with accessibility validation.
3. Establish locale routing, ICU catalogs, formatting, pseudo-locales, RTL behavior, and localized
   component stress tests.
4. Build the responsive app shell, tenant context, global search/command pattern, record header, forms,
   feedback, data display, and complex-task compositions.
5. Persist organization theme publication and individual appearance/density/locale preferences with
   server-resolved startup.
6. Add the component catalog, automated accessibility checks, visual regression, and interaction tests.
7. Validate the first vertical workflows with representative users and iterate before broad feature
   expansion.

The current bootstrap screen demonstrates the intended warm, restrained direction but is not yet the
ShopOS design system or authenticated application shell.
