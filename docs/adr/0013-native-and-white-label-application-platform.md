# ADR 0013: Native and white-label applications share one platform

- Status: Accepted
- Date: 2026-07-24

## Context

ShopOS needs technician- and customer-focused mobile applications, may need a desktop application, and
should let qualified organizations purchase a customer-facing app under their own name and store
listing. Building separate product forks per shop would fragment security, features, localization,
store compliance, releases, and support.

Native clients also create requirements that responsive web alone does not settle: device sessions,
secure local storage, offline queues, camera and scanning, push notifications, deep links, app-store
ownership, signing credentials, release channels, account deletion, and fleet support.

Apple limits commercial template-app services unless the content provider submits the app directly,
and it accepts an aggregated/picker model. Google Play prohibits catalogs of apps with highly similar
functionality, content, and user experience. Store distribution ownership must therefore be part of
the product architecture.

## Decision

- Keep the responsive ShopOS web/PWA as the complete shop-operations surface.
- Build iOS and Android applications with React Native and the open-source Expo toolchain.
- Create a technician-first ShopOS Staff application and a separate shared ShopOS Customer
  application.
- Produce qualified branded customer apps from the same customer codebase and release train using
  validated control-plane configuration. Do not create organization-specific source forks.
- Publish the shared customer app from ShopOS's store accounts.
- Normally publish a branded app from the shop or ownership group's organization developer accounts,
  with ShopOS receiving scoped release access as a managed service.
- Require meaningful shop-specific content or services and a policy/operational eligibility review;
  branding alone does not qualify an organization for a separate listing.
- Keep mobile clients behind stable, versioned API contracts. The server remains authoritative for
  identity linkage, tenant context, permissions, workflows, prices, totals, and approvals.
- Store mobile application definitions, entitlements, approved branding, publisher ownership, secret
  references, release manifests, review state, rollout, and retirement in the SaaS control plane.
- Use Expo Application Services only as a replaceable build-time/operations option. Preserve a
  documented native build path and add no proprietary runtime dependency.
- Defer the desktop runtime decision. Use the installable PWA first and compare a lightweight web
  shell, React Native Windows/macOS, and platform web packaging against proven device requirements.

## Consequences

- API versioning, native session lifecycle, device registration, push, deep links, media uploads,
  offline policy, privacy/account deletion, telemetry, localization, and native design tokens become
  prerequisites rather than afterthoughts.
- Customer identity can link to records in multiple organizations, but the server preserves strict
  tenant isolation and never exposes one shop relationship to another.
- White-label configuration and release operations become billable, entitlement-controlled
  control-plane capabilities with audit history.
- Shops need organization developer accounts, legal/store materials, and ongoing responsibilities to
  receive a branded app.
- A failed or retired branded app does not affect access to canonical ShopOS records through the shared
  app or web.
- Mobile features follow stable domain workflows instead of inventing parallel business rules.
- Desktop development remains evidence-driven and cannot delay the web or mobile roadmaps.

## Rejected alternatives

### Fork the application for each shop

Rejected because security fixes, features, translations, store policy, and releases would drift across
customers and make the platform uneconomical to maintain.

### Publish every branded app from ShopOS's accounts

Rejected as the default because it conflicts with Apple's template-app guidance, concentrates store
enforcement risk, and weakens the shop's ownership of its branded customer channel.

### Offer only branded apps

Rejected because many shops will not need a separate listing or maintain developer accounts. The
shared ShopOS Customer app also gives multi-shop customers one coherent experience.

### Share one user interface across web, mobile, and desktop

Rejected because contracts, tokens, copy, and calculations can be shared, while input methods,
navigation, density, offline behavior, and native capabilities require surface-specific composition.

### Choose a desktop runtime now

Rejected because current requirements do not prove that a native shell adds enough value beyond the
installable PWA to justify another release and security surface.
