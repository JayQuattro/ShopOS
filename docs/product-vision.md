# Product vision

## Outcome

ShopOS helps a shop understand its customers and assets, plan and authorize work, execute it, collect
payment, and retain a trustworthy operational history.

Automotive repair is the initial proving ground. The platform must also fit motorcycle, marine,
lawn-equipment, fleet, equipment-repair, restoration, performance, fabrication, and custom-build shops
without forcing each market into vehicle-specific data.

## Product promise

- Approachable enough for a small independent shop
- Structured enough for multi-location operations
- A polished managed SaaS and a genuinely self-hostable application from the same codebase
- Core functionality that remains useful without paid data or messaging providers
- Multilingual staff and customer experiences without making a translation provider a core dependency
- Clear records of what was proposed, authorized, completed, invoiced, and paid

## Initial users

Owners, managers, service advisors, technicians, parts personnel, and administrative staff are primary
shop users. Customers participate initially only through a narrow estimate-authorization flow.

## Initial product surface

The bootstrap covers the responsive shop-operations web application and the minimum token-based
customer authorization experience. Native mobile apps, advanced scheduling, inventory, accounting
integrations, subscription billing, and a plugin marketplace are out of scope.

## Business model

The open-source core and managed service use the same product. Sustainable revenue may come from
hosting, onboarding, migration, support, communications, storage, integrations, reporting, branded
applications, training, and enterprise implementation—not artificial removal of core shop operations.

## Experience principles

- Make the next safe action obvious.
- Show status, authorization, blockers, totals, and recent activity where work is managed.
- Prefer useful defaults and progressive disclosure to dense setup forms.
- Make customer and asset retrieval fast.
- Avoid duplicate entry.
- Support responsive layouts, keyboard use, and baseline accessibility.
- Localize product messages, formatting, and bidirectional layouts from the start.
- Preserve original user content and clearly label optional machine translations.
- Apply familiar industry terminology at presentation boundaries while keeping the core domain general.

## Success for the bootstrap

A developer can run the application locally, load deterministic examples, and demonstrate one
tenant-safe repair workflow from customer creation through a manual payment. Estimates and
authorizations retain revision history; important financial behavior and denial paths are tested.
