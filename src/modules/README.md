# Business modules

Each module owns its language, policies, application services, repository contracts, and view models.
HTTP routes and UI code depend on module entry points instead of reaching into another module's storage.

## Bootstrap modules

| Module           | Initial responsibility                                         |
| ---------------- | -------------------------------------------------------------- |
| `identity`       | Human identity, sessions, and authentication boundaries        |
| `organizations`  | Tenant onboarding, settings, and subscription-ready state      |
| `locations`      | Operational locations and time zones                           |
| `memberships`    | Built-in role templates and membership workflows               |
| `tenancy`        | Membership, permissions, location access, and request context  |
| `platform`       | SaaS operator authorization, lifecycle, entitlement, and audit |
| `customers`      | Individual/business profiles, contacts, preferences, and notes |
| `assets`         | General asset record and typed industry profiles               |
| `work-orders`    | Concerns, requested work, assignment, blockers, and status     |
| `estimates`      | Priced service snapshots and immutable revisions               |
| `authorizations` | Approval/decline evidence against a presented revision         |
| `invoicing`      | Immutable invoice snapshot and balance                         |
| `payments`       | Manual receipts and invoice allocation                         |
| `activity`       | User-facing lifecycle history and domain events                |
| `audit`          | Security-sensitive mutation history                            |
| `integrations`   | Replaceable provider contracts                                 |
| `shared`         | Small, stable primitives such as money; no business grab bag   |

Only modules with implemented behavior have source beyond contracts today. Add module code as a complete
vertical slice, and keep `docs/roadmap.md` honest.
