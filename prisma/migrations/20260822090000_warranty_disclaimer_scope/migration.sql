-- Per-job and per-line warranty terms and disclaimer scoping.

-- Warranty terms on individual invoice lines; the invoice-level terms act as
-- the default (fallback) so a job without explicit terms inherits the RO
-- warranty, while jobs like brakes can carry different terms than oil changes.
ALTER TABLE "invoice_lines"
  ADD COLUMN "warranty_months" INTEGER,
  ADD COLUMN "warranty_miles" INTEGER;

DO $$ BEGIN
  ALTER TABLE "invoice_lines"
    ADD CONSTRAINT "invoice_lines_warranty_months_check"
    CHECK ("warranty_months" IS NULL OR "warranty_months" > 0);
  ALTER TABLE "invoice_lines"
    ADD CONSTRAINT "invoice_lines_warranty_miles_check"
    CHECK ("warranty_miles" IS NULL OR "warranty_miles" > 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Disclaimer scope: invoice-wide (default, both null), a job (snapshotted
-- group key + label), or one exact line.
ALTER TABLE "invoice_disclaimers"
  ADD COLUMN "service_group_key" VARCHAR(80),
  ADD COLUMN "service_group_label" VARCHAR(160),
  ADD COLUMN "invoice_line_id" UUID;

DO $$ BEGIN
  ALTER TABLE "invoice_disclaimers"
    ADD CONSTRAINT "invoice_disclaimers_org_invoice_line_fk"
    FOREIGN KEY ("organization_id", "invoice_line_id")
    REFERENCES "invoice_lines"("organization_id", "id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX "invoice_disclaimers_org_invoice_line_idx"
  ON "invoice_disclaimers"("organization_id", "invoice_line_id");
