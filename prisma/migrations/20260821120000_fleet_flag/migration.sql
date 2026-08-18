-- Fleet vehicles: explicit opt-in flag on assets so loaner pickers, roadside
-- dispatch, and the fleet page stop relying on naming conventions. No
-- backfill — shops mark their own vehicles in the fleet page.

ALTER TABLE "assets" ADD COLUMN "is_fleet_vehicle" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "assets_org_fleet_idx" ON "assets"("organization_id", "is_fleet_vehicle") WHERE "is_fleet_vehicle";
