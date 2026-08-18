-- Inventory: on-hand quantities and reorder points for stocked parts. Part
-- orders can receive into stock; issuing consumes it. Money stays integer
-- minor units + ISO currency. Tenant-scoped like everything else.

CREATE TABLE "inventory_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "part_number" VARCHAR(120) NOT NULL,
  "name" VARCHAR(220) NOT NULL,
  "quantity_on_hand" INTEGER NOT NULL DEFAULT 0,
  "reorder_point" INTEGER NOT NULL DEFAULT 0,
  "unit_cost_minor" BIGINT NOT NULL DEFAULT 0,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
  "bin_location" VARCHAR(80),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventory_items_quantity_check" CHECK ("quantity_on_hand" >= 0),
  CONSTRAINT "inventory_items_reorder_check" CHECK ("reorder_point" >= 0),
  CONSTRAINT "inventory_items_currency_check" CHECK (currency ~ '^[A-Z]{3}$')
);

CREATE UNIQUE INDEX "inventory_items_org_id_unique" ON "inventory_items"("organization_id", "id");
CREATE UNIQUE INDEX "inventory_items_org_part_number_unique"
  ON "inventory_items"("organization_id", "part_number");
CREATE INDEX "inventory_items_org_low_stock_idx"
  ON "inventory_items"("organization_id") WHERE "quantity_on_hand" <= "reorder_point";

ALTER TABLE "inventory_items"
  ADD CONSTRAINT "inventory_items_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
