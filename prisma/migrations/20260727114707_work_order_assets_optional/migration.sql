-- Make WorkOrder.assetId nullable (supports customer-level work with no asset).
ALTER TABLE "work_orders" ALTER COLUMN "asset_id" DROP NOT NULL;

-- WorkOrderAsset join table (many-to-many between work orders and assets).
CREATE TABLE "work_order_assets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "work_order_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "role" VARCHAR(32) NOT NULL DEFAULT 'primary',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_order_assets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "work_order_assets_org_wo_asset_unique"
  ON "work_order_assets" ("organization_id", "work_order_id", "asset_id");

CREATE UNIQUE INDEX "work_order_assets_org_id_unique"
  ON "work_order_assets" ("organization_id", "id");

CREATE INDEX "work_order_assets_org_wo_idx"
  ON "work_order_assets" ("organization_id", "work_order_id");

ALTER TABLE "work_order_assets"
  ADD CONSTRAINT "work_order_assets_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "work_order_assets"
  ADD CONSTRAINT "work_order_assets_organization_id_work_order_id_fkey"
  FOREIGN KEY ("organization_id", "work_order_id") REFERENCES "work_orders"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "work_order_assets"
  ADD CONSTRAINT "work_order_assets_organization_id_asset_id_fkey"
  FOREIGN KEY ("organization_id", "asset_id") REFERENCES "assets"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
