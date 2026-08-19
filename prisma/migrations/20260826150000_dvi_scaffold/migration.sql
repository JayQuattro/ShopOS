-- Digital vehicle inspections (ADR 0018 scaffold): checklists per work
-- order with positioned items carrying condition, notes, and media.
-- Attachments gain an inspection-item link so photos belong to the brake
-- line, not just the job. Item conditions feed recommendations that bridge
-- to estimate lines. Sharing uses the tracker's signed-token pattern.

CREATE TYPE "inspection_item_condition" AS ENUM ('ok', 'watch', 'replace', 'na');

CREATE TABLE "inspection_templates" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "name" VARCHAR(180) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "inspection_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "inspection_templates_org_id_unique" ON "inspection_templates"("organization_id", "id");

ALTER TABLE "inspection_templates"
  ADD CONSTRAINT "inspection_templates_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "inspection_template_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "inspection_template_id" UUID NOT NULL,
  "position" INTEGER NOT NULL,
  "zone" VARCHAR(80),
  "component" VARCHAR(160) NOT NULL,
  CONSTRAINT "inspection_template_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "inspection_template_items_position_unique"
  ON "inspection_template_items"("organization_id", "inspection_template_id", "position");

ALTER TABLE "inspection_template_items"
  ADD CONSTRAINT "inspection_template_items_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inspection_template_items"
  ADD CONSTRAINT "inspection_template_items_org_template_fk"
  FOREIGN KEY ("organization_id", "inspection_template_id")
  REFERENCES "inspection_templates"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "inspections" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "location_id" UUID NOT NULL,
  "work_order_id" UUID NOT NULL,
  "inspection_template_id" UUID,
  "title" VARCHAR(180) NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'draft',
  "performed_by_user_id" UUID,
  "completed_at" TIMESTAMPTZ(6),
  "shared_token" VARCHAR(64),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "inspections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inspections_status_check" CHECK ("status" IN ('draft', 'completed', 'shared')),
  CONSTRAINT "inspections_completed_state_check" CHECK (
    ("status" = 'draft' AND "completed_at" IS NULL) OR
    ("status" <> 'draft' AND "completed_at" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "inspections_org_id_unique" ON "inspections"("organization_id", "id");
CREATE UNIQUE INDEX "inspections_shared_token_key" ON "inspections"("shared_token");
CREATE INDEX "inspections_org_work_order_idx" ON "inspections"("organization_id", "work_order_id");

ALTER TABLE "inspections"
  ADD CONSTRAINT "inspections_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inspections"
  ADD CONSTRAINT "inspections_org_location_fk"
  FOREIGN KEY ("organization_id", "location_id") REFERENCES "locations"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inspections"
  ADD CONSTRAINT "inspections_org_work_order_fk"
  FOREIGN KEY ("organization_id", "work_order_id") REFERENCES "work_orders"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "inspections"
  ADD CONSTRAINT "inspections_org_template_fk"
  FOREIGN KEY ("organization_id", "inspection_template_id")
  REFERENCES "inspection_templates"("organization_id", "id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "inspections"
  ADD CONSTRAINT "inspections_performed_by_fk"
  FOREIGN KEY ("performed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "inspection_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "inspection_id" UUID NOT NULL,
  "position" INTEGER NOT NULL,
  "zone" VARCHAR(80),
  "component" VARCHAR(160) NOT NULL,
  "condition" "inspection_item_condition" NOT NULL DEFAULT 'ok',
  "note" TEXT,
  "recommended" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "inspection_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "inspection_items_org_id_unique" ON "inspection_items"("organization_id", "id");
CREATE UNIQUE INDEX "inspection_items_position_unique"
  ON "inspection_items"("organization_id", "inspection_id", "position");
CREATE INDEX "inspection_items_org_inspection_idx" ON "inspection_items"("organization_id", "inspection_id");

ALTER TABLE "inspection_items"
  ADD CONSTRAINT "inspection_items_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inspection_items"
  ADD CONSTRAINT "inspection_items_org_inspection_fk"
  FOREIGN KEY ("organization_id", "inspection_id") REFERENCES "inspections"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "work_order_attachments" ADD COLUMN "inspection_item_id" UUID;

ALTER TABLE "work_order_attachments"
  ADD CONSTRAINT "attachments_org_inspection_item_fk"
  FOREIGN KEY ("organization_id", "inspection_item_id")
  REFERENCES "inspection_items"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
