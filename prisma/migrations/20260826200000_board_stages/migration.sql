-- Custom workflow stages (the Shopmonkey flexibility pattern): the board's
-- columns become org-configurable — name, order, color — while the built-in
-- vehicle_stage stays as the compatibility fallback for orgs that never
-- configure stages. A cleared stage returns the work order to that fallback.

CREATE TABLE "board_stages" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "key" VARCHAR(40) NOT NULL,
  "label" VARCHAR(60) NOT NULL,
  "color_hint" VARCHAR(20),
  "sort_order" INTEGER NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "board_stages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "board_stages_key_shape_check" CHECK ("key" ~ '^[a-z0-9_-]{1,40}$')
);

CREATE UNIQUE INDEX "board_stages_org_id_unique" ON "board_stages"("organization_id", "id");
CREATE UNIQUE INDEX "board_stages_org_key_unique" ON "board_stages"("organization_id", "key");
CREATE INDEX "board_stages_org_order_idx" ON "board_stages"("organization_id", "active", "sort_order");

ALTER TABLE "board_stages"
  ADD CONSTRAINT "board_stages_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "work_orders" ADD COLUMN "board_stage_id" UUID;

ALTER TABLE "work_orders"
  ADD CONSTRAINT "work_orders_org_board_stage_fk"
  FOREIGN KEY ("organization_id", "board_stage_id")
  REFERENCES "board_stages"("organization_id", "id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "work_orders_org_board_stage_idx"
  ON "work_orders"("organization_id", "board_stage_id") WHERE "board_stage_id" IS NOT NULL;
