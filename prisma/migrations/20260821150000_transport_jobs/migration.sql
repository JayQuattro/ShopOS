-- Pickup & delivery: moving customer vehicles between the shop and their
-- location with a driver and (optionally) a shop fleet vehicle. Reuses the
-- maps connector for geocoding and the one-shot ETA snapshot at dispatch.

CREATE TYPE "transport_kind" AS ENUM ('pickup', 'delivery');

CREATE TYPE "transport_status" AS ENUM ('scheduled', 'en_route', 'completed', 'cancelled');

CREATE TABLE "transport_jobs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "location_id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "asset_id" UUID,
  "work_order_id" UUID,
  "kind" "transport_kind" NOT NULL,
  "status" "transport_status" NOT NULL DEFAULT 'scheduled',
  "scheduled_at" TIMESTAMPTZ(6),
  "contact_phone" VARCHAR(32) NOT NULL,
  "address_line1" VARCHAR(220) NOT NULL,
  "address_line2" VARCHAR(220),
  "city" VARCHAR(120) NOT NULL,
  "state_province" VARCHAR(80) NOT NULL,
  "postal_code" VARCHAR(20) NOT NULL,
  "lat" DOUBLE PRECISION,
  "lng" DOUBLE PRECISION,
  "geocoded_formatted" TEXT,
  "driver_user_id" UUID,
  "fleet_asset_id" UUID,
  "eta_seconds" INTEGER,
  "distance_meters" INTEGER,
  "note" TEXT,
  "started_at" TIMESTAMPTZ(6),
  "completed_at" TIMESTAMPTZ(6),
  "cancelled_at" TIMESTAMPTZ(6),
  "cancel_reason" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "transport_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "transport_eta_check" CHECK (
    ("eta_seconds" IS NULL OR "eta_seconds" >= 0) AND
    ("distance_meters" IS NULL OR "distance_meters" >= 0)
  ),
  CONSTRAINT "transport_terminal_state_check" CHECK (
    ("status" <> 'completed' OR "completed_at" IS NOT NULL) AND
    ("status" <> 'cancelled' OR "cancelled_at" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "transport_jobs_org_id_unique" ON "transport_jobs"("organization_id", "id");
CREATE INDEX "transport_jobs_org_location_status_idx" ON "transport_jobs"("organization_id", "location_id", "status");
CREATE INDEX "transport_jobs_org_driver_idx" ON "transport_jobs"("organization_id", "driver_user_id") WHERE "driver_user_id" IS NOT NULL;

ALTER TABLE "transport_jobs"
  ADD CONSTRAINT "transport_jobs_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "transport_jobs"
  ADD CONSTRAINT "transport_jobs_org_location_fk"
  FOREIGN KEY ("organization_id", "location_id") REFERENCES "locations"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "transport_jobs"
  ADD CONSTRAINT "transport_jobs_org_customer_fk"
  FOREIGN KEY ("organization_id", "customer_id") REFERENCES "customers"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "transport_jobs"
  ADD CONSTRAINT "transport_jobs_org_asset_fk"
  FOREIGN KEY ("organization_id", "asset_id") REFERENCES "assets"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "transport_jobs"
  ADD CONSTRAINT "transport_jobs_org_work_order_fk"
  FOREIGN KEY ("organization_id", "work_order_id") REFERENCES "work_orders"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "transport_jobs"
  ADD CONSTRAINT "transport_jobs_driver_fk"
  FOREIGN KEY ("driver_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "transport_jobs"
  ADD CONSTRAINT "transport_jobs_org_fleet_asset_fk"
  FOREIGN KEY ("organization_id", "fleet_asset_id") REFERENCES "assets"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
