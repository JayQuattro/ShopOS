# Mobile strategy

Native mobile applications are not part of the bootstrap. The responsive shop web application should
cover common tablet and phone use without creating a separate domain implementation.

Future surfaces may include:

- a technician-focused application
- a shared customer application connecting customers to participating shops
- branded customer applications for a shop or chain

Branded applications should share one codebase and use validated configuration for name, bundle ID,
icons, splash assets, colors, enabled features, locations, contact details, store metadata, and
notification settings. They must not become independent product forks.

Mobile and web clients should call stable application/API boundaries for identity, customers, assets,
service requests, estimates, authorizations, work status, messages, files, invoices, payments, push
notifications, and project updates. Offline behavior, device trust, deep links, push-token handling,
store operations, and account deletion require dedicated design before mobile implementation.
