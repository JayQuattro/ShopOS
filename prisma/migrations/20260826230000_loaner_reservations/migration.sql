-- Loaner reservations: promise a shop vehicle for a window (typically tied
-- to an upcoming appointment). Availability checks overlap reservations and
-- open checkouts so the same vehicle is never promised twice. A reservation
-- converts to a checkout on the work order without losing the window.

CREATE TABLE "loaner_reservations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "location_id" UUID NOT NULL,
  "asset_id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "work_order_id" UUID,
  "reserved_from" TIMESTAMPTZ(6) NOT NULL,
  "reserved_to" TIMESTAMPTZ(6) NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'reserved',
  "note" TEXT,
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "loaner_reservations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "loaner_reservation_status_check" CHECK ("status" IN ('reserved', 'converted', 'cancelled')),
  CONSTRAINT "loaner_reservation_window_check" CHECK ("reserved_to" > "reserved_from")
);

CREATE UNIQUE INDEX "loaner_reservations_org_id_unique" ON "loaner_reservations"("organization_id", "id");
CREATE INDEX "loaner_reservations_org_asset_window_idx"
  ON "loaner_reservations"("organization_id", "asset_id", "reserved_from");

-- A vehicle cannot hold two overlapping active reservations.
CREATE UNIQUE INDEX "loaner_reservations_no_overlap"
  ON "loaner_reservations"("organization_id", "asset_id", "reserved_from")
  WHERE "status" = 'reserved';

ALTER TABLE "loaner_reservations"
  ADD CONSTRAINT "loaner_reservations_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "loaner_reservations"
  ADD CONSTRAINT "loaner_reservations_org_location_fk"
  FOREIGN KEY ("organization_id", "location_id") REFERENCES "locations"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "loaner_reservations"
  ADD CONSTRAINT "loaner_reservations_org_asset_fk"
  FOREIGN KEY ("organization_id", "asset_id") REFERENCES "assets"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "loaner_reservations"
  ADD CONSTRAINT "loaner_reservations_org_customer_fk"
  FOREIGN KEY ("organization_id", "customer_id") REFERENCES "customers"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "loaner_reservations"
  ADD CONSTRAINT "loaner_reservations_org_work_order_fk"
  FOREIGN KEY ("organization_id", "work_order_id") REFERENCES "work_orders"("organization_id", "id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "loaner_reservations"
  ADD CONSTRAINT "loaner_reservations_created_by_fk"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
