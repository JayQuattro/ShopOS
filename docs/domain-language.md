# Domain language

These terms are canonical in code and storage. Industry terminology belongs in presentation
configuration unless a concept is genuinely different.

| Term                       | Meaning                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------ |
| Platform                   | The ShopOS-operated or self-hosted installation boundary                                   |
| Ownership group            | Optional future parent of organizations for chains or holding companies                    |
| Organization               | A shop business, operating company, chain, or brand; the primary tenant                    |
| Location                   | A physical or operational shop inside an organization                                      |
| User                       | A human identity that may participate in multiple organizations                            |
| Membership                 | A user's relationship and role assignment within an organization                           |
| Location access            | The locations a non-organization-wide member may access                                    |
| Customer                   | An individual or business receiving service from an organization                           |
| Contact                    | A person or channel associated with a customer                                             |
| Asset                      | Something the shop services, repairs, maintains, modifies, inspects, fabricates, or builds |
| Work order                 | The operational record coordinating requested and performed work for an asset              |
| Concern                    | A customer's reported need, symptom, or desired outcome                                    |
| Service group              | A customer-understandable grouping of related labor, parts, fees, and discounts            |
| Estimate                   | A priced proposal represented by one or more immutable revisions once presented            |
| Authorization              | A recorded approval or decline of an estimate revision's eligible scope                    |
| Invoice                    | A issued financial claim for completed work                                                |
| Payment                    | Money received and allocated to an invoice                                                 |
| Activity event             | User-facing history of meaningful work-order events                                        |
| Audit event                | Security and compliance history of important reads or mutations                            |
| Adapter definition         | Code-shipped provider implementation and versioned capability/configuration contract       |
| Connector instance         | One configured provider connection owned by the platform, an organization, or a location   |
| Connector assignment       | Tenant policy selecting a connector instance for a capability and optional fallback        |
| Platform-managed connector | A provider account operated by ShopOS and explicitly offered to eligible organizations     |
| Customer-managed connector | A provider account supplied and controlled by one organization                             |

## Industry presentation terms

Automotive defaults may display Asset as Vehicle, Work Order as Repair Order, and usage as Mileage.
Marine and equipment configurations may prefer Vessel, Unit, hours, hull identifiers, or serial numbers.
These labels must not change authorization or storage identity.

## Money and time

Money is represented by integer minor units and ISO 4217 currency. Recorded instants are stored in UTC.
Locations carry IANA time zones for calendars and display.

## Avoid

Do not use `car`, `vehicle_owner`, `repair_order`, or `mileage` as universal core concepts. A typed
automotive asset profile may contain vehicle-specific fields without making the base Asset automotive.
