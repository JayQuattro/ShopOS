-- Stacked taxes (Canada-style GST + PST/QST): tax rates sharing a stack
-- group apply together on one base, each component rounding separately
-- (CRA-acceptable) and snapshotted per line for display and history.

ALTER TABLE "tax_rates" ADD COLUMN "stack_group" VARCHAR(60);

CREATE INDEX "tax_rates_org_stack_idx"
  ON "tax_rates"("organization_id", "stack_group") WHERE "stack_group" IS NOT NULL;

ALTER TABLE "estimate_lines" ADD COLUMN "tax_components" JSONB NOT NULL DEFAULT '[]';

ALTER TABLE "invoice_lines" ADD COLUMN "tax_components" JSONB NOT NULL DEFAULT '[]';
