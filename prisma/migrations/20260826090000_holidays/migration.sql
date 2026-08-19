-- Per-location holiday calendars: shops configure what closes them —
-- Thanksgiving vs Boxing Day vs regional saints' days — and the booking
-- guard refuses new appointments on all-day closures while showing the
-- reason. Dates are local to the location's time zone by nature (a DATE,
-- never an instant).

CREATE TABLE "location_holidays" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "location_id" UUID NOT NULL,
  "date" DATE NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "closes_all_day" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "location_holidays_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "location_holidays_org_loc_date_unique"
  ON "location_holidays"("organization_id", "location_id", "date");

ALTER TABLE "location_holidays"
  ADD CONSTRAINT "location_holidays_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "location_holidays"
  ADD CONSTRAINT "location_holidays_org_location_fk"
  FOREIGN KEY ("organization_id", "location_id") REFERENCES "locations"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
