-- Inventory depth: location scoping (the same part number can live at
-- multiple shops with its own on-hand), part identity (OE interchange
-- number, brand, category), units of measure with grouping (quarts/gallons/
-- drums of the same oil), condition (new/used/refurb), cores, and the
-- consumable / non-saleable supply flags (rags, gloves — reordered, never
-- sold). Existing org-wide part numbers stay valid as location-null rows.

DROP INDEX IF EXISTS "inventory_items_org_part_number_unique";

ALTER TABLE "inventory_items" ADD COLUMN "location_id" UUID;
ALTER TABLE "inventory_items" ADD COLUMN "oe_number" VARCHAR(120);
ALTER TABLE "inventory_items" ADD COLUMN "brand" VARCHAR(120);
ALTER TABLE "inventory_items" ADD COLUMN "category_id" UUID;
ALTER TABLE "inventory_items" ADD COLUMN "uom_group" VARCHAR(60);
ALTER TABLE "inventory_items" ADD COLUMN "unit_of_measure" VARCHAR(40);
ALTER TABLE "inventory_items" ADD COLUMN "uom_factor_milli" INTEGER;
ALTER TABLE "inventory_items" ADD COLUMN "condition" VARCHAR(16) NOT NULL DEFAULT 'new';
ALTER TABLE "inventory_items" ADD COLUMN "has_core" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "inventory_items" ADD COLUMN "core_value_minor" BIGINT;
ALTER TABLE "inventory_items" ADD COLUMN "consumable" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "inventory_items" ADD COLUMN "non_saleable" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "inventory_items" ADD COLUMN "notes" TEXT;

ALTER TABLE "inventory_items"
  ADD CONSTRAINT "inventory_condition_check" CHECK ("condition" IN ('new', 'used', 'refurb'));
ALTER TABLE "inventory_items"
  ADD CONSTRAINT "inventory_uom_factor_check" CHECK ("uom_factor_milli" IS NULL OR "uom_factor_milli" > 0);
ALTER TABLE "inventory_items"
  ADD CONSTRAINT "inventory_core_check" CHECK ("has_core" OR "core_value_minor" IS NULL);

CREATE UNIQUE INDEX "inventory_items_org_loc_part_unique"
  ON "inventory_items"("organization_id", COALESCE("location_id", '00000000-0000-0000-0000-000000000000'::uuid), "part_number");

CREATE INDEX "inventory_items_org_oe_idx" ON "inventory_items"("organization_id", "oe_number") WHERE "oe_number" IS NOT NULL;
CREATE INDEX "inventory_items_org_category_idx" ON "inventory_items"("organization_id", "category_id") WHERE "category_id" IS NOT NULL;

ALTER TABLE "inventory_items"
  ADD CONSTRAINT "inventory_items_org_location_fk"
  FOREIGN KEY ("organization_id", "location_id") REFERENCES "locations"("organization_id", "id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "inventory_categories" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "inventory_categories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "inventory_categories_org_id_unique" ON "inventory_categories"("organization_id", "id");
CREATE UNIQUE INDEX "inventory_categories_org_name_unique" ON "inventory_categories"("organization_id", "name");

ALTER TABLE "inventory_categories"
  ADD CONSTRAINT "inventory_categories_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inventory_items"
  ADD CONSTRAINT "inventory_items_org_category_fk"
  FOREIGN KEY ("organization_id", "category_id") REFERENCES "inventory_categories"("organization_id", "id") ON DELETE SET NULL ON UPDATE CASCADE;
