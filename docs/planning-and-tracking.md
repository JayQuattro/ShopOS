# Planning and issue tracking

## Recommendation

Use GitHub as the initial public source of truth:

- GitHub Discussions for open-ended product discovery and partner suggestions
- GitHub Issues for accepted, actionable work
- Milestones for release outcomes
- One GitHub Project with table, board, and roadmap views
- `docs/roadmap.md` for the durable narrative and scope boundaries

Linear is a good later internal planning layer when the team needs stronger cycles, initiatives, and
portfolio planning. If introduced, synchronize issues with GitHub and define GitHub as canonical for
community-visible status. Do not manually maintain two independent backlogs.

Plane and OpenProject are credible self-hosted alternatives if planning-data sovereignty becomes more
important than operational simplicity.

## Intake workflow

1. Capture a problem or partner opportunity in Discussions or the project inbox.
2. Record evidence: customer segment, frequency, operational pain, commercial/API access, security and
   compliance implications, and alternatives.
3. Move validated ideas into a scoped issue with acceptance criteria.
4. Mark the horizon and commitment separately. `Later` or `exploring` is not a delivery promise.
5. Link implementation pull requests and ADRs.
6. Close the loop with release notes and updated product documentation.

## Integration discovery checklist

Before committing a payment, financing, warranty, CARFAX, or other partner integration, confirm:

- documented and contractually available API access
- test/sandbox access
- authentication and secret-rotation model
- data ownership, retention, privacy, and customer-consent requirements
- webhook delivery, idempotency, retry, reconciliation, and outage behavior
- certification, branding, support, and commercial obligations
- tenant/location scoping and audit requirements
- a provider-independent fallback for existing ShopOS records
