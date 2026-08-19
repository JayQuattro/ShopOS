# ADR 0017: E-invoicing document connectors

Date: 2026-08-25

## Status

Accepted

## Context

A growing set of jurisdictions legally mandate machine-readable e-invoices:
Germany (XRechnung/ZUGFeRD for B2B), France (Factur-X), Italy (SDI
FatturaPA clearance), Mexico (CFDI via a PAC), Poland (KSeF), India (IRN via
a GSP), Spain (VeriFactu), Brazil (NFS-e per city). Two distinct shapes:

1. **Format mandates** (DE/FR): the invoice must _carry_ a standard XML
   (EN16931 — CII for Factur-X/ZUGFeRD, UBL for XRechnung) alongside the
   human document. No government system is involved in issuance; exchange is
   peer-to-peer.
2. **Clearance mandates** (IT/MX/PL/IN/ES/BR): the invoice must be submitted
   to or authorized by a government system, always through an accredited
   intermediary (SDI, PAC, KSeF credentials, GSP/IRP). ShopOS cannot and
   should not become an accredited intermediary.

## Decision

E-invoicing is a connector family in the ADR 0008 sense, split by shape:

- **Format adapters are pure document builders**: issued-invoice data in,
  standard XML out. No credentials, no network. The organization selects its
  format (Factur-X, XRechnung, later FatturaPA-as-file); generation is
  deterministic from the stored invoice snapshot, and each generated document
  is itself snapshotted (`e_invoice_documents`) with a content hash — issued
  invoices never change, so the XML is a reproducible projection, but the
  stored copy is the record of what was transmitted.
- **Clearance adapters are BYO-intermediary connectors** like payments:
  organization-scoped credentials for their accredited intermediary, a
  `submit` boundary returning the government identifier (SDI transmission
  id, CFDI UUID + SAT stamp, KSeF reference, IRN). Registered as slots;
  implemented per country when demand exists. The platform never holds
  intermediary accreditation.

Tax registration IDs (#194), per-establishment numbering (#194), the
VAT-inclusive/exclusive snapshot (#195), and stacked tax components (#196)
are direct inputs; the XML reflects the invoice's stored convention, never
live settings.

## Consequences

- DE/FR shops get compliant B2B invoices with zero external dependencies.
- Clearance countries can generate their XML (FatturaPA) for manual/intermediary
  submission today; automated submission follows the connector seam.
- Format correctness is golden-tested; amount semantics (inclusive vs
  exclusive tax, stacked components) are covered per mode.

## Out of scope for v1

PDF/A-3 embedding (XML ships alongside the PDF); EN16931 full profiles beyond
what ShopOS data models (allowances/charges beyond our discount model);
KSeF/CFDI/IRN submission; VeriFactu event streams.
