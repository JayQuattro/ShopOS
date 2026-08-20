-- Parts-order purpose tracking and systematic receiving: orders declare
-- whether they're job-specific, plain stock replenishment, or stock bought
-- for a planned upcoming job; stock orders no longer require a work order;
-- lines link explicitly to inventory items so receiving bumps stock
-- automatically. Existing orders become JOB purpose (they all carried a
-- work order).

CREATE TYPE "part_order_purpose" AS ENUM ('job', 'replenish', 'allocation');

ALTER TABLE "part_orders" ADD COLUMN "purpose" "part_order_purpose" NOT NULL DEFAULT 'job';

ALTER TABLE "part_orders" ALTER COLUMN "work_order_id" DROP NOT NULL;

DROP INDEX IF EXISTS "part_orders_org_wo_idx";
ALTER TABLE "part_orders"
  DROP CONSTRAINT IF EXISTS "part_orders_org_work_order_fk";
ALTER TABLE "part_orders"
  ADD CONSTRAINT "part_orders_org_work_order_fk"
  FOREIGN KEY ("organization_id", "work_order_id")
  REFERENCES "work_orders"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "part_orders_org_supplier_status_idx"
  ON "part_orders"("organization_id", "supplier_id", "status");

ALTER TABLE "part_order_lines" ADD COLUMN "inventory_item_id" UUID;

CREATE INDEX "part_order_lines_org_item_idx"
  ON "part_order_lines"("organization_id", "inventory_item_id")
  WHERE "inventory_item_id" IS NOT NULL;

ALTER TABLE "part_order_lines"
  ADD CONSTRAINT "part_order_lines_org_item_fk"
  FOREIGN KEY ("organization_id", "inventory_item_id")
  REFERENCES "inventory_items"("organization_id", "id") ON DELETE SET NULL ON UPDATE CASCADE;
