-- Business hours and booking capacity per location (settings roadmap): weekly
-- open windows per weekday plus slot length and concurrent-appointment
-- capacity, enforced when appointments are created or rescheduled.

CREATE TABLE "location_business_hours" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "location_id" UUID NOT NULL,
  "weekday" INTEGER NOT NULL,
  "open_minute" INTEGER NOT NULL,
  "close_minute" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "location_business_hours_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "business_hours_values_check" CHECK (
    "weekday" BETWEEN 0 AND 6
    AND "open_minute" >= 0 AND "open_minute" < 1440
    AND "close_minute" > 0 AND "close_minute" <= 1440
    AND "close_minute" > "open_minute"
  )
);

CREATE UNIQUE INDEX "location_business_hours_org_id_unique"
  ON "location_business_hours"("organization_id", "id");
CREATE UNIQUE INDEX "location_business_hours_org_location_weekday_unique"
  ON "location_business_hours"("organization_id", "location_id", "weekday");

ALTER TABLE "location_business_hours"
  ADD CONSTRAINT "location_business_hours_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "location_business_hours"
  ADD CONSTRAINT "location_business_hours_org_location_fk"
  FOREIGN KEY ("organization_id", "location_id") REFERENCES "locations"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "locations"
  ADD COLUMN "slot_minutes" INTEGER NOT NULL DEFAULT 60,
  ADD COLUMN "booking_capacity" INTEGER NOT NULL DEFAULT 1,
  ADD CONSTRAINT "locations_slot_check" CHECK ("slot_minutes" BETWEEN 15 AND 480),
  ADD CONSTRAINT "locations_capacity_check" CHECK ("booking_capacity" BETWEEN 1 AND 50);
