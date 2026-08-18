-- Mobile / roadside service calls (ops breadth): dispatch a technician to a
-- customer location for jumpstarts, tire changes, lockouts, and mobile repair.
-- Service location is geocoded and routed through the maps connector when one
-- is active; the lat/lng + ETA are one-shot snapshots at dispatch time.

CREATE TYPE "service_call_kind" AS ENUM (
  'jumpstart',
  'tire_change',
  'fuel_delivery',
  'lockout',
  'battery',
  'tow_coordination',
  'mobile_repair',
  'other'
);

CREATE TYPE "service_call_status" AS ENUM (
  'requested',
  'dispatched',
  'en_route',
  'on_scene',
  'completed',
  'cancelled'
);

CREATE TABLE "service_calls" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "location_id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "kind" "service_call_kind" NOT NULL,
  "status" "service_call_status" NOT NULL DEFAULT 'requested',
  "contact_phone" VARCHAR(32) NOT NULL,
  "address_line1" VARCHAR(220) NOT NULL,
  "address_line2" VARCHAR(220),
  "city" VARCHAR(120) NOT NULL,
  "state_province" VARCHAR(80) NOT NULL,
  "postal_code" VARCHAR(20) NOT NULL,
  "lat" DOUBLE PRECISION,
  "lng" DOUBLE PRECISION,
  "geocoded_formatted" TEXT,
  "assigned_technician_user_id" UUID,
  "fleet_asset_id" UUID,
  "note" TEXT,
  "eta_seconds" INTEGER,
  "distance_meters" INTEGER,
  "work_order_id" UUID,
  "dispatched_at" TIMESTAMPTZ(6),
  "en_route_at" TIMESTAMPTz(6),
  "on_scene_at" TIMESTAMPTZ(6),
  "completed_at" TIMESTAMPTZ(6),
  "cancelled_at" TIMESTAMPTZ(6),
  "cancel_reason" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "service_calls_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "service_call_eta_check" CHECK (
    ("eta_seconds" IS NULL OR "eta_seconds" >= 0) AND
    ("distance_meters" IS NULL OR "distance_meters" >= 0)
  ),
  CONSTRAINT "service_call_terminal_state_check" CHECK (
    ("status" <> 'completed' OR "completed_at" IS NOT NULL) AND
    ("status" <> 'cancelled' OR "cancelled_at" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "service_calls_org_id_unique" ON "service_calls"("organization_id", "id");
CREATE INDEX "service_calls_org_location_status_idx" ON "service_calls"("organization_id", "location_id", "status");
CREATE INDEX "service_calls_org_technician_idx" ON "service_calls"("organization_id", "assigned_technician_user_id") WHERE "assigned_technician_user_id" IS NOT NULL;
CREATE INDEX "service_calls_org_fleet_asset_idx" ON "service_calls"("organization_id", "fleet_asset_id") WHERE "fleet_asset_id" IS NOT NULL;

ALTER TABLE "service_calls"
  ADD CONSTRAINT "service_calls_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "service_calls"
  ADD CONSTRAINT "service_calls_org_location_fk"
  FOREIGN KEY ("organization_id", "location_id") REFERENCES "locations"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "service_calls"
  ADD CONSTRAINT "service_calls_org_customer_fk"
  FOREIGN KEY ("organization_id", "customer_id") REFERENCES "customers"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "service_calls"
  ADD CONSTRAINT "service_calls_technician_fk"
  FOREIGN KEY ("assigned_technician_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "service_calls"
  ADD CONSTRAINT "service_calls_org_fleet_asset_fk"
  FOREIGN KEY ("organization_id", "fleet_asset_id") REFERENCES "assets"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "service_calls"
  ADD CONSTRAINT "service_calls_org_work_order_fk"
  FOREIGN KEY ("organization_id", "work_order_id") REFERENCES "work_orders"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
