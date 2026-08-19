-- E-invoice format documents: a generated, hashed snapshot of the standard
-- XML for an issued invoice (Factur-X/ZUGFeRD CII, XRechnung UBL, later
-- FatturaPA). One per invoice — regenerating replaces the projection and
-- audit-logs the fact; the invoice itself is immutable history.

CREATE TABLE "e_invoice_documents" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "invoice_id" UUID NOT NULL,
  "format" VARCHAR(32) NOT NULL,
  "xml" TEXT NOT NULL,
  "content_hash" VARCHAR(64) NOT NULL,
  "generated_by_user_id" UUID NOT NULL,
  "generated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "e_invoice_documents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "e_invoice_format_check" CHECK ("format" IN ('factur-x', 'xrechnung', 'fatturapa'))
);

CREATE UNIQUE INDEX "e_invoice_documents_org_invoice_unique"
  ON "e_invoice_documents"("organization_id", "invoice_id");

ALTER TABLE "e_invoice_documents"
  ADD CONSTRAINT "e_invoice_documents_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "e_invoice_documents"
  ADD CONSTRAINT "e_invoice_documents_org_invoice_fk"
  FOREIGN KEY ("organization_id", "invoice_id") REFERENCES "invoices"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "e_invoice_documents"
  ADD CONSTRAINT "e_invoice_documents_generated_by_fk"
  FOREIGN KEY ("generated_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Org-level format selection (country-driven): null = none.
ALTER TABLE "organizations" ADD COLUMN "einvoice_format" VARCHAR(16);

ALTER TABLE "organizations"
  ADD CONSTRAINT "organizations_einvoice_format_check"
  CHECK ("einvoice_format" IS NULL OR "einvoice_format" IN ('factur-x', 'xrechnung', 'fatturapa'));
