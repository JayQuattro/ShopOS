-- Fleet document expiries: registration and insurance for shop vehicles.
-- The fleet page surfaces upcoming and overdue expiries so a service
-- truck never runs on lapsed paper.

ALTER TABLE "assets"
  ADD COLUMN "registration_expires_at" TIMESTAMPTZ(6),
  ADD COLUMN "insurance_expires_at" TIMESTAMPTZ(6);

CREATE INDEX "assets_org_fleet_docs_idx"
  ON "assets"("organization_id")
  WHERE "is_fleet_vehicle" AND ("registration_expires_at" IS NOT NULL OR "insurance_expires_at" IS NOT NULL);
