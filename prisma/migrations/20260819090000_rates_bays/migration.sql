-- Shop-configurable labor rate and tax presets (settings roadmap), plus
-- named bays per location for the Vehicle card and Work board.

ALTER TABLE "organizations"
  ADD COLUMN "default_labor_rate_minor" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "default_tax_rate_basis_points" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "org_labor_rate_check" CHECK ("default_labor_rate_minor" >= 0),
  ADD CONSTRAINT "org_tax_rate_check" CHECK ("default_tax_rate_basis_points" BETWEEN 0 AND 10000);

CREATE TABLE "location_bays" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "location_id" UUID NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "location_bays_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "location_bays_name_check" CHECK (char_length("name") BETWEEN 1 AND 80)
);

CREATE UNIQUE INDEX "location_bays_org_id_unique" ON "location_bays"("organization_id", "id");
CREATE UNIQUE INDEX "location_bays_org_location_name_unique"
  ON "location_bays"("organization_id", "location_id", "name");
CREATE INDEX "location_bays_org_location_active_idx"
  ON "location_bays"("organization_id", "location_id", "active");

ALTER TABLE "location_bays"
  ADD CONSTRAINT "location_bays_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "location_bays"
  ADD CONSTRAINT "location_bays_org_location_fk"
  FOREIGN KEY ("organization_id", "location_id") REFERENCES "locations"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
