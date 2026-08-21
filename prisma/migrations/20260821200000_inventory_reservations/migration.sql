-- Inventory reservations: soft holds of on-hand stock for a pending work
-- order / estimate. Reservations are an allocation layer over on-hand —
-- they never change quantity_on_hand and never write movement rows until
-- the hold is issued (consumed) onto a job. Declined estimate lines,
-- superseded revisions, and cancelled work orders release their holds.

CREATE TYPE "inventory_reservation_status" AS ENUM (
  'active',
  'released',
  'consumed'
);

CREATE TABLE "inventory_reservations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "inventory_item_id" UUID NOT NULL,
  "work_order_id" UUID NOT NULL,
  "estimate_line_id" UUID,
  "quantity" INTEGER NOT NULL,
  "status" "inventory_reservation_status" NOT NULL DEFAULT 'active',
  "note" VARCHAR(280),
  "created_by_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "released_at" TIMESTAMPTZ(6),
  "consumed_at" TIMESTAMPTZ(6),
  CONSTRAINT "inventory_reservations_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "inventory_reservations"
  ADD CONSTRAINT "inventory_reservations_quantity_check"
  CHECK ("quantity" > 0);

DO $$ BEGIN
  ALTER TABLE "inventory_reservations"
    ADD CONSTRAINT "inventory_reservations_org_fk"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
  ALTER TABLE "inventory_reservations"
    ADD CONSTRAINT "inventory_reservations_org_item_fk"
    FOREIGN KEY ("organization_id", "inventory_item_id")
    REFERENCES "inventory_items"("organization_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
  ALTER TABLE "inventory_reservations"
    ADD CONSTRAINT "inventory_reservations_org_work_order_fk"
    FOREIGN KEY ("organization_id", "work_order_id")
    REFERENCES "work_orders"("organization_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
  ALTER TABLE "inventory_reservations"
    ADD CONSTRAINT "inventory_reservations_org_estimate_line_fk"
    FOREIGN KEY ("organization_id", "estimate_line_id")
    REFERENCES "estimate_lines"("organization_id", "id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  ALTER TABLE "inventory_reservations"
    ADD CONSTRAINT "inventory_reservations_created_by_fk"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX "inventory_reservations_org_id_unique"
  ON "inventory_reservations"("organization_id", "id");

CREATE INDEX "inventory_reservations_org_item_status_idx"
  ON "inventory_reservations"("organization_id", "inventory_item_id", "status");

CREATE INDEX "inventory_reservations_org_work_order_status_idx"
  ON "inventory_reservations"("organization_id", "work_order_id", "status");

-- Availability scans only live holds.
CREATE INDEX "inventory_reservations_org_item_active_idx"
  ON "inventory_reservations"("organization_id", "inventory_item_id")
  WHERE "status" = 'active';
