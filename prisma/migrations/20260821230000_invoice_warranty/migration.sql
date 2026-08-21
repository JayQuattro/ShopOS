-- Warranty terms on invoices, with org-level defaults. Terms default from
-- the organization (best practice, shop-adjustable), are editable while the
-- invoice is DRAFT, and freeze at issue like the rest of the document.
-- Coverage checks derive from issued invoices — no separate truth to drift.

ALTER TABLE "organizations"
  ADD COLUMN "default_warranty_months" INTEGER,
  ADD COLUMN "default_warranty_miles" INTEGER;

DO $$ BEGIN
  ALTER TABLE "organizations"
    ADD CONSTRAINT "organizations_default_warranty_months_check"
    CHECK ("default_warranty_months" IS NULL OR "default_warranty_months" > 0);
  ALTER TABLE "organizations"
    ADD CONSTRAINT "organizations_default_warranty_miles_check"
    CHECK ("default_warranty_miles" IS NULL OR "default_warranty_miles" > 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "invoices"
  ADD COLUMN "warranty_months" INTEGER,
  ADD COLUMN "warranty_miles" INTEGER;

DO $$ BEGIN
  ALTER TABLE "invoices"
    ADD CONSTRAINT "invoices_warranty_months_check"
    CHECK ("warranty_months" IS NULL OR "warranty_months" > 0);
  ALTER TABLE "invoices"
    ADD CONSTRAINT "invoices_warranty_miles_check"
    CHECK ("warranty_miles" IS NULL OR "warranty_miles" > 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX "invoices_org_work_order_idx"
  ON "invoices"("organization_id", "work_order_id");
