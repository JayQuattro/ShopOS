# ADR 0009: Customizable ShopOS design system

- Status: Accepted
- Date: 2026-07-23

## Context

ShopOS must support frequent operational work, occasional administration, customer-facing actions, and
complex financial or authorization flows. Its users have different roles, devices, technical comfort,
and volume. A collection of locally styled screens would make common actions inconsistent and complex
actions risky.

The product also needs a recognizable default design and controlled organization customization.
Hard-coded colors cannot support accessible light/dark variants, organization preferences, customer
branding, or user appearance settings. Arbitrary customer CSS would make accessibility, upgrades,
support, and security unpredictable.

## Decision

Use shadcn/ui as the primary source-owned component foundation and semantic CSS variables as the theme
contract. Foundational primitives are centralized; domain-specific ShopOS compositions build on them.
Feature modules do not create parallel button, form, dialog, table, status, or feedback systems.

The default design is warm, restrained, editorial, and content-first, inspired by Anthropic's public
site without copying its identity. Operational clarity, scan speed, financial legibility, and workflow
state take priority over decoration.

Ship Light, Dark, Warm, Dusk, and System presets. Resolve design configuration in these layers:

1. protected ShopOS semantic/accessibility constraints
2. ShopOS defaults
3. the organization's published theme and allowed preferences
4. the user's permitted mode, preset, and density preference
5. operating-system accessibility and color-scheme preferences

Organizations may customize approved semantic/brand tokens and assets through validated
in-application administration. They cannot supply arbitrary CSS or component markup. Functional status
colors are protected or constrained. Publishing requires token completeness and contrast validation,
supports preview and rollback, and is audited.

Use a shared interaction pattern for high-consequence and complex actions: orient, configure, validate,
review, commit with an outcome-specific label, and confirm/recover. Target WCAG 2.2 Level AA throughout
the component and feature lifecycle.

## Consequences

ShopOS gains consistent interaction, accessible theme customization, source-owned components, and a
clear path for responsive web and later branded mobile surfaces. Organization branding and personal
comfort preferences can coexist without forking product code.

The team must maintain tokens, presets, component compositions, content guidance, a catalog, keyboard
behavior, accessibility checks, visual regression, and migration discipline when shadcn sources are
updated. A shadcn component is not considered ShopOS-ready until its states, content, accessibility,
responsive behavior, and domain use have been reviewed.

Highly branded customer requests may be declined when they would undermine contrast, semantics,
security, or upgradeability.
