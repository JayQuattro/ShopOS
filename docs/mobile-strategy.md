# Native, desktop, and white-label application strategy

## Product surfaces

ShopOS should develop one platform with several deliberate client experiences:

| Surface                   | Primary users                                    | Initial distribution               | Purpose                                                                                         |
| ------------------------- | ------------------------------------------------ | ---------------------------------- | ----------------------------------------------------------------------------------------------- |
| Responsive ShopOS web/PWA | Owners, advisors, parts, administration          | Browser/installable web app        | Complete shop operations and the broadest device coverage                                       |
| ShopOS Staff              | Technicians first, then other mobile staff roles | ShopOS iOS and Android apps        | Fast, task-focused work at the asset, bay, lot, or job site                                     |
| ShopOS Customer           | Customers of one or more participating shops     | ShopOS iOS and Android apps        | Shared garage, service, authorization, messaging, invoice, and payment experience               |
| Branded customer app      | Customers of an entitled shop or ownership group | Shop-owned store listings          | A shop-specific customer channel using the same maintained application product                  |
| Optional desktop shell    | Shop staff with proven native-device needs       | Managed installer or desktop store | Native printing, scanning, peripheral, or resilient/offline behavior not served well by the PWA |

The responsive web application remains the complete operational product. Native clients are focused
experiences, not independent domain implementations. A technician must not need a customer-oriented
app, and customers must never receive staff permissions or staff-only data.

The first branded product is customer-facing. White-label staff apps add store and support cost without
much customer-visible value and should remain an entitlement option only after demand is proven.

## Recommended technology

Use React Native with the open-source Expo toolchain for iOS and Android. Expo Application Services may
be offered as a replaceable build, signing, update, and submission service, but ShopOS must retain a
documented local/native build path and must not depend on a proprietary service at runtime.

Keep the repository capable of becoming a pnpm workspace with:

```text
apps/
  web/                 # existing Next.js application, moved only when worthwhile
  staff-mobile/        # ShopOS Staff
  customer-mobile/     # shared and branded customer application
packages/
  api-contracts/       # versioned request/response schemas and stable error codes
  design-tokens/       # semantic intent translated for web and native
  localization/        # ICU catalog source and formatter contracts
  mobile-core/         # auth, networking, secure storage, telemetry, and update policy
  customer-experience/ # shared customer screens and feature composition
```

Do not move the working web app merely to make the folder tree look complete. Introduce workspace
packages incrementally when the first native proof of concept needs them.

Share contracts, semantic tokens, localization sources, and pure calculations where safe. Do not
import server repositories, authorization services, Prisma models, secrets, or browser components into
native clients. The server remains authoritative for tenant context, permissions, workflow state,
prices, totals, and approvals.

React Native for Windows and macOS is technically possible, but desktop should not be assumed to share
the mobile UI wholesale. Start with the installable PWA. Run a later proof of concept comparing:

- a lightweight web shell such as Tauri for maximum reuse of the operational web application
- React Native Windows/macOS for native interaction and shared mobile primitives
- platform web-app packaging when it satisfies device, update, and security requirements

Choose a desktop runtime only after testing required printers, scanners, cameras, local files,
notifications, update policy, offline behavior, accessibility, and enterprise deployment.

## Stable mobile platform boundary

Native work begins only after the workflows it consumes have stable application services. Mobile
clients call a versioned API boundary rather than importing server code or binding to raw Prisma
shapes.

The mobile-ready platform must include:

- versioned schemas, pagination, stable error codes, request correlation, and capability discovery
- short-lived mobile sessions, secure refresh/revocation, device records, and OAuth/PKCE-compatible
  federation
- explicit organization and location selection that is reauthorized on every server request
- idempotency keys for mutations and resumable media upload
- scoped push registration, deep links, universal/app links, and safe notification payloads
- remotely evaluated entitlements and feature availability
- account export/deletion, consent, privacy, and data-retention workflows
- structured mobile release, crash, performance, and adoption telemetry without sensitive payloads

Better Auth remains the identity owner. A native integration must use its supported mobile/session
boundary rather than create parallel token or identity tables.

## ShopOS Staff: technician-first plan

The first native vertical should be a technician alpha because camera, scanning, mobility, and offline
capture can provide value beyond responsive web.

Initial technician scope:

- secure sign-in, organization/location selection, and device/session management
- assigned work and a concise today/queue view
- customer/asset/work-order summaries appropriate to the technician's permissions
- status changes and blocked-work reasons
- inspections, notes, time capture, and parts/service requests
- camera-first photo/video and document capture with resumable upload
- VIN, barcode, or QR scanning where supported
- background-safe draft and upload queues
- push notifications for assignment and workflow changes

Offline support is deliberate and bounded. Cache only the minimum assigned records needed for field
work in an encrypted store partitioned by actor, organization, and location. Queue idempotent draft
operations, surface conflicts, reauthorize before synchronization, and erase tenant data on logout,
membership revocation, organization suspension, or remote wipe. Never make offline state authoritative
for approvals, pricing, financial totals, or permissions.

## ShopOS Customer: shared app plan

The shared ShopOS Customer app is the default mobile offering and the safe option for shops that do not
need or qualify for a separate store listing.

Initial customer scope:

- link a verified ShopOS identity to customer records through explicit, auditable consent
- connect to shops using invitations, secure links, QR codes, or verified contact matching
- switch between participating shops without merging their tenant data
- view a customer-owned garage/assets and relevant service history
- request service and manage appointments when scheduling is available
- receive status updates and exchange messages/files
- review estimates and complete authorization using immutable presentation records
- view invoices, pay through tokenized/hosted provider flows, and retain receipts
- manage communication, locale, accessibility, privacy, export, and deletion preferences

A customer identity can relate to records in multiple organizations, but each organization remains a
separate authorization and data boundary. Shop A cannot discover a customer's relationship or data
from Shop B.

## Branded shop applications

Branded apps use the same customer application code and release train. They are configurations and
distribution records, never forks.

### Configuration model

Store validated, audited configuration in the SaaS control plane:

- owning organization or ownership group and entitled locations
- immutable iOS bundle identifier and Android application ID
- app name, icons, splash assets, semantic theme tokens, and supported locales
- store descriptions, screenshots, category, support URL, privacy URL, legal owner, and age rating
- enabled customer features and organization-specific content/services
- universal/app-link domains, push configuration references, and associated credentials
- Apple/Google publisher account ownership and delegated release access
- release channel, minimum supported version, review status, rollout, and retirement state

Build-time values such as bundle identifiers come from a versioned, approved release manifest. Runtime
configuration comes from a signed/validated API response bound to that application identity. Neither
uses arbitrary environment variables as the source of product configuration.

### Store ownership and policy

Apple's App Review Guideline 4.2.6 says apps produced by a commercial template service should be
submitted directly by the provider of the app's content; it also allows one aggregated/picker app.
Google Play prohibits multiple apps with highly similar functionality, content, and user experience.

Therefore:

- ShopOS publishes and operates the shared ShopOS Customer app.
- A branded app is normally published by the shop or ownership group's legal organization account.
- The shop grants ShopOS narrowly scoped build/submission access; ShopOS may operate releases as a
  managed service without becoming the publisher of record.
- A shop that cannot maintain compliant organization accounts uses the shared ShopOS Customer app.
- Every branded-app request passes an eligibility and content review. A new icon and theme alone are
  insufficient; the app needs meaningful organization-owned content, services, or customer value.
- Store approval is never guaranteed. Rejection, transfer, account loss, certificate expiration, and
  retirement must have documented recovery paths.

Official policy references:

- <https://developer.apple.com/app-store/review/guidelines/#minimum-functionality>
- <https://support.google.com/googleplay/android-developer/answer/9899034>
- <https://developer.apple.com/help/app-store-connect/transfer-an-app/overview-of-app-transfer>

### Release factory

The white-label service should automate, but not hide, the release lifecycle:

1. confirm entitlement, legal ownership, store accounts, support capacity, and unique customer value
2. collect and validate brand, locale, privacy, legal, and store-listing material
3. reserve identifiers and provision scoped signing, push, and deep-link credentials
4. generate a deterministic release manifest and reproducible native projects
5. run unit, API-contract, tenant-isolation, accessibility, localization, visual, and device tests
6. produce preview builds for the shop's approval
7. submit through the correct publisher account and record review state
8. stage rollout, monitor health, support rollback, and enforce minimum versions only when necessary
9. renew certificates/profiles and keep store privacy disclosures current
10. retire or transfer the app without losing access to the customer's existing ShopOS data

Over-the-air updates, if used, must be cryptographically signed and isolated by application identity,
native runtime version, environment, and release channel. A release intended for one shop must never
reach another shop's branded binary.

## Cross-cutting requirements

### Security and privacy

- Store credentials only in native secure storage; never persist passwords or raw provider secrets.
- Keep push payloads free of sensitive customer, asset, financial, or work-detail content. Fetch after
  the authorized user opens the app.
- Record device/session lifecycle and allow user, organization, and platform revocation.
- Apply least privilege to camera, photos, location, contacts, microphone, Bluetooth, and local-network
  permissions; request access only at the feature that needs it.
- Treat deep links, QR codes, cached identifiers, and notification actions as untrusted transport
  input.
- Threat-model rooted/jailbroken devices, screenshots, log collection, backups, clipboard use, lost
  devices, and shared shop tablets without claiming the client can be made a trusted boundary.

### Localization, theming, and accessibility

- Use the same BCP 47 locale policy and ICU message semantics as web.
- Generate native catalogs from reviewed canonical sources; do not duplicate business copy manually.
- Support RTL, text expansion, mixed-direction identifiers, locale-aware formatting, and per-user
  preferences.
- Translate organization themes into protected native semantic tokens. Arbitrary React Native styles,
  code, or remote markup are not accepted from tenants.
- Meet platform accessibility expectations plus the ShopOS WCAG 2.2 AA intent, including dynamic text,
  screen readers, switch/keyboard input where applicable, contrast, reduced motion, and touch targets.

### Product and operations

- Gate native and branded capabilities through SaaS plans and entitlements.
- Meter build, storage, push, translation, messaging, support, and release-management cost separately
  from customer transactions.
- Publish a support/responsibility matrix covering ShopOS, the shop, Apple/Google, and integration
  providers.
- Maintain supported OS/runtime ranges and a predictable deprecation policy.
- Test upgrades from every supported production version, not just clean installs.

## Delivery stages and exit criteria

### Stage A: mobile readiness

- Approve the native/white-label ADR and repository layout.
- Prove Better Auth native sessions, API versioning, secure storage, push registration, deep links,
  telemetry, localization, theme translation, and contract testing.
- Exit when one authenticated vertical slice works on physical iOS and Android devices with
  cross-tenant denial tests.

### Stage B: ShopOS Staff technician alpha

- Deliver the technician scope to internal/demo shops.
- Prove camera/media, draft queue, constrained offline behavior, revocation, and remote wipe.
- Exit when representative technicians can complete a defined work-order task sequence reliably.

### Stage C: shared ShopOS Customer beta

- Deliver customer identity linking, multi-shop switching, service visibility, estimate authorization,
  messaging, invoices, and payments as the underlying web workflows become stable.
- Exit after privacy, account deletion, tenant isolation, accessibility, localization, and store beta
  review.

### Stage D: branded-app pilot

- Pilot with a small number of qualified organizations using shop-owned publisher accounts.
- Prove configuration validation, preview approval, deterministic builds, store submission, isolated
  updates, support, renewal, transfer, and retirement.
- Exit only when the release factory is repeatable without per-shop code branches.

### Stage E: scale and desktop decision

- Add self-service configuration only for fields that can be safely validated.
- Automate fleet release health and compliance evidence.
- Run the desktop proof of concept against documented hardware/offline requirements.
- Offer a desktop binary only if it provides material value beyond the installable PWA.

Native development should not jump ahead of the underlying customer, asset, work-order, estimate,
authorization, messaging, invoice, payment, scheduling, and file workflows. Early platform spikes are
appropriate; production surface delivery follows stable server behavior.
