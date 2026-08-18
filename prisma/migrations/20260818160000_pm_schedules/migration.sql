-- Preventive maintenance schedules: per-asset recurring services with
-- time/mileage intervals, the last completed service, and reminder state so
-- the worker sweep texts customers when service is due without spamming.

CREATE TABLE "maintenance_schedules" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "asset_id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "interval_miles" INTEGER,
  "interval_months" INTEGER,
  "last_serviced_at" TIMESTAMPTZ(6),
  "last_serviced_mileage" INTEGER,
  "last_reminded_at" TIMESTAMPTZ(6),
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "maintenance_schedules_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "maintenance_schedules_intervals_check"
  CHECK ("interval_miles" IS NOT NULL OR "interval_months" IS NOT NULL),
  CONSTRAINT "maintenance_schedules_values_check"
  CHECK (
    ("interval_miles" IS NULL OR "interval_miles" > 0) AND
    ("interval_months" IS NULL OR "interval_months" > 0)
  )
);

CREATE UNIQUE INDEX "maintenance_schedules_org_id_unique" ON "maintenance_schedules"("organization_id", "id");
CREATE UNIQUE INDEX "maintenance_schedules_org_asset_name_unique"
  ON "maintenance_schedules"("organization_id", "asset_id", "name");
CREATE INDEX "maintenance_schedules_org_active_idx"
  ON "maintenance_schedules"("organization_id", "active");

ALTER TABLE "maintenance_schedules"
  ADD CONSTRAINT "maintenance_schedules_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "maintenance_schedules"
  ADD CONSTRAINT "maintenance_schedules_org_asset_fk"
  FOREIGN KEY ("organization_id", "asset_id") REFERENCES "assets"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "automotive_asset_profiles"
  ADD COLUMN "last_known_mileage" INTEGER,
  ADD CONSTRAINT "automotive_profiles_mileage_check" CHECK ("last_known_mileage" IS NULL OR "last_known_mileage" >= 0);
