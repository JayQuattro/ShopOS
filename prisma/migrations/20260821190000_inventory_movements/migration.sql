-- Inventory movement ledger: every stock change (receiving, issuing to a
-- job, manual adjustment, return) is recorded as an append-only row with
-- lineage to the work order and part-order line that caused it.
-- quantity_on_hand stays the maintained fast-read column; this ledger is
-- the auditable history ("where did my brake pads go").

CREATE TYPE "inventory_movement_reason" AS ENUM (
  'received',
  'issued_to_job',
  'manual_adjustment',
  'returned_to_stock'
);

CREATE TABLE "inventory_movements" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "location_id" UUID,
  "inventory_item_id" UUID NOT NULL,
  "delta" INTEGER NOT NULL,
  "reason" "inventory_movement_reason" NOT NULL DEFAULT 'manual_adjustment',
  "work_order_id" UUID,
  "part_order_line_id" UUID,
  "note" VARCHAR(280),
  "created_by_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "inventory_movements"
  ADD CONSTRAINT "inventory_movements_delta_check"
  CHECK ("delta" <> 0);

-- Reason values are constrained by the enum type above.

DO $$ BEGIN
  ALTER TABLE "inventory_movements"
    ADD CONSTRAINT "inventory_movements_org_fk"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
  ALTER TABLE "inventory_movements"
    ADD CONSTRAINT "inventory_movements_org_location_fk"
    FOREIGN KEY ("organization_id", "location_id")
    REFERENCES "locations"("organization_id", "id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  ALTER TABLE "inventory_movements"
    ADD CONSTRAINT "inventory_movements_org_item_fk"
    FOREIGN KEY ("organization_id", "inventory_item_id")
    REFERENCES "inventory_items"("organization_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
  ALTER TABLE "inventory_movements"
    ADD CONSTRAINT "inventory_movements_org_work_order_fk"
    FOREIGN KEY ("organization_id", "work_order_id")
    REFERENCES "work_orders"("organization_id", "id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  ALTER TABLE "inventory_movements"
    ADD CONSTRAINT "inventory_movements_org_part_order_line_fk"
    FOREIGN KEY ("organization_id", "part_order_line_id")
    REFERENCES "part_order_lines"("organization_id", "id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  ALTER TABLE "inventory_movements"
    ADD CONSTRAINT "inventory_movements_created_by_fk"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX "inventory_movements_org_id_unique"
  ON "inventory_movements"("organization_id", "id");

CREATE INDEX "inventory_movements_org_item_created_idx"
  ON "inventory_movements"("organization_id", "inventory_item_id", "created_at" DESC);

CREATE INDEX "inventory_movements_org_work_order_idx"
  ON "inventory_movements"("organization_id", "work_order_id");

-- Ledger immutability: rows are append-only. Corrections are new rows.
CREATE OR REPLACE FUNCTION "inventory_movements_block_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'inventory_movements are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "inventory_movements_no_update"
  BEFORE UPDATE OR DELETE ON "inventory_movements"
  FOR EACH ROW EXECUTE FUNCTION "inventory_movements_block_mutation"();
