-- Parts-to-stock linkage across the money flow: estimate part lines may
-- reference a stocked inventory item, invoice lines copy that reference at
-- invoicing, and stock consumption writes movements keyed to the invoice
-- line (idempotent). Auto-consume is best-effort and org-toggleable:
-- invoicing never blocks on inventory state.

ALTER TABLE "organizations"
  ADD COLUMN "auto_issue_stock_on_invoice" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "estimate_lines"
  ADD COLUMN "inventory_item_id" UUID;

ALTER TABLE "invoice_lines"
  ADD COLUMN "inventory_item_id" UUID;

ALTER TABLE "inventory_movements"
  ADD COLUMN "invoice_line_id" UUID;

-- Tenant identity unique the other line tables already carry.
CREATE UNIQUE INDEX "invoice_lines_org_id_unique"
  ON "invoice_lines"("organization_id", "id");

DO $$ BEGIN
  ALTER TABLE "estimate_lines"
    ADD CONSTRAINT "estimate_lines_org_item_fk"
    FOREIGN KEY ("organization_id", "inventory_item_id")
    REFERENCES "inventory_items"("organization_id", "id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  ALTER TABLE "invoice_lines"
    ADD CONSTRAINT "invoice_lines_org_item_fk"
    FOREIGN KEY ("organization_id", "inventory_item_id")
    REFERENCES "inventory_items"("organization_id", "id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  ALTER TABLE "inventory_movements"
    ADD CONSTRAINT "inventory_movements_org_invoice_line_fk"
    FOREIGN KEY ("organization_id", "invoice_line_id")
    REFERENCES "invoice_lines"("organization_id", "id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX "estimate_lines_org_item_idx"
  ON "estimate_lines"("organization_id", "inventory_item_id");

CREATE INDEX "invoice_lines_org_item_idx"
  ON "invoice_lines"("organization_id", "inventory_item_id");

-- One consumption movement per invoice line, ever.
CREATE UNIQUE INDEX "inventory_movements_org_invoice_line_uidx"
  ON "inventory_movements"("organization_id", "invoice_line_id")
  WHERE "invoice_line_id" IS NOT NULL;
