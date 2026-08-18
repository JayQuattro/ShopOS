# Organization Settings Roadmap

Last updated: 2026-08-18

ShopOS organization settings live as typed columns on `organizations` with
audited service updates (`work-preferences-service`, `org-profile-service`), zod-
validated APIs under `/api/organizations/:id/settings/*`, and pages under
`/app/:org/settings/*` sharing a section nav. This file tracks what exists, what
is planned next, and the deliberately deferred.

## Implemented

| Setting                                                  | Where                   | Default                  |
| -------------------------------------------------------- | ----------------------- | ------------------------ |
| Shop name, contact phone/email, website, address         | Settings → Shop profile | empty                    |
| Change-order credit policy                               | Work preferences        | AUTO_APPLY               |
| Invoice line policy                                      | Work preferences        | APPROVED_ONLY            |
| Paper size                                               | Work preferences        | LETTER                   |
| Email delivery connector                                 | Email delivery          | none (platform fallback) |
| Authorization link TTL                                   | Work preferences        | 72 h                     |
| Work-order / invoice number prefixes                     | Work preferences        | RO- / INV-               |
| Quality check required                                   | Work preferences        | on                       |
| Notification toggles (7 families)                        | Notifications           | all on                   |
| Appointment reminder lead / no-show cutoff / PM cooldown | Notifications           | 24 h / 2 h / 30 d        |

## Planned next

- **Business hours & booking capacity** — per-location hours, slot length,
  max concurrent appointments; feeds the Schedule's day view and online booking.
- **Labor rates & tax presets** — default shop labor rate and named tax rates
  applied by service templates instead of per-line entry.
- **Review request deep links** — Google/Yelp URLs appended by the review
  handler when configured.
- **Bay list** — named bays per location for the Vehicle card and Work board
  filters (today bay labels are free text).
- **Upload limits** — org-level max attachment size and MIME allowlist
  overrides.
- **Customer-portal locale & units** — per-org default locale for the tracker,
  authorize page, and emails (depends on the #60 locale preferences work).

## Deferred deliberately

- **Raw CSS / arbitrary theming** — themes are preset + semantic tokens only
  (ADR 0009); no customer CSS.
- **Financial policy escapes** — money representation, issued-document
  immutability, and approval gates are not settings.
- **SMS fallback configuration** — rides the connector framework; no
  per-notification-channel routing yet.
