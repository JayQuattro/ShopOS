-- Tax identity and legal invoice series. The organization's tax
-- registration number (VAT/EIN/GSTIN/RFC/CNPJ) and the customer's (B2B
-- cross-border) belong on invoices; many jurisdictions require gapless
-- per-establishment numbering, so invoice numbers become unique per
-- (organization, location) instead of organization-wide, and a location
-- may carry its own series prefix.

ALTER TABLE "organizations" ADD COLUMN "tax_id" VARCHAR(32);

ALTER TABLE "customers" ADD COLUMN "tax_id" VARCHAR(32);

ALTER TABLE "locations" ADD COLUMN "invoice_number_prefix" VARCHAR(12);

ALTER TABLE "invoices" DROP CONSTRAINT "invoices_org_number_unique";

CREATE UNIQUE INDEX "invoices_org_location_number_unique"
  ON "invoices"("organization_id", "location_id", "number");
