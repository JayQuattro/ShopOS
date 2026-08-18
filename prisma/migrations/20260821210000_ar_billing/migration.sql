-- Accounts receivable: business customers billed on account (statements,
-- aging) and PO references captured on account work orders. Additive and
-- nullable; every shop starts with direct pay-at-pickup behavior.

ALTER TABLE "customers" ADD COLUMN "is_account_customer" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "customers_org_account_idx"
  ON "customers"("organization_id", "is_account_customer")
  WHERE "is_account_customer";

ALTER TABLE "work_orders" ADD COLUMN "po_number" VARCHAR(60);
