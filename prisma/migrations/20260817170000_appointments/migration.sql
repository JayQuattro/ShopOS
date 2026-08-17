-- Appointments: what's coming in the door (ADR 0014 breadth arc). A shop's
-- day view keyed by location and start time; statuses advance toward a work
-- order, which the appointment may reference once created. Instants are UTC;
-- display uses the location's IANA time zone.

CREATE TYPE "appointment_status" AS ENUM (
  'scheduled', 'confirmed', 'checked_in', 'completed', 'cancelled', 'no_show'
);

CREATE TABLE "appointments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "location_id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "asset_id" UUID,
  "work_order_id" UUID,
  "status" "appointment_status" NOT NULL DEFAULT 'scheduled',
  "reason" VARCHAR(500) NOT NULL,
  "notes" TEXT,
  "start_at" TIMESTAMPTZ(6) NOT NULL,
  "end_at" TIMESTAMPTZ(6) NOT NULL,
  "created_by_user_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "appointments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "appointments_time_check" CHECK ("end_at" > "start_at")
);

CREATE UNIQUE INDEX "appointments_org_id_unique" ON "appointments"("organization_id", "id");
CREATE INDEX "appointments_org_location_start_idx"
  ON "appointments"("organization_id", "location_id", "start_at");
CREATE INDEX "appointments_org_customer_start_idx"
  ON "appointments"("organization_id", "customer_id", "start_at");

ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_org_location_fk"
  FOREIGN KEY ("organization_id", "location_id") REFERENCES "locations"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_org_customer_fk"
  FOREIGN KEY ("organization_id", "customer_id") REFERENCES "customers"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_org_asset_fk"
  FOREIGN KEY ("organization_id", "asset_id") REFERENCES "assets"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_org_work_order_fk"
  FOREIGN KEY ("organization_id", "work_order_id") REFERENCES "work_orders"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
