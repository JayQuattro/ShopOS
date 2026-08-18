-- Loaner vehicles and sublet work (ops depth): loaners are shop-owned assets
-- checked out to customers against a work order; sublets track work sent to
-- outside vendors (machine shop, glass, calibration) with quoted/actual cost.

CREATE TABLE "loaner_checkouts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "location_id" UUID NOT NULL,
  "work_order_id" UUID NOT NULL,
  "asset_id" UUID NOT NULL,
  "checked_out_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "checked_in_at" TIMESTAMPTZ(6),
  "out_mileage" INTEGER,
  "in_mileage" INTEGER,
  "note" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "loaner_checkouts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "loaner_mileage_check" CHECK (
    ("out_mileage" IS NULL OR "out_mileage" >= 0) AND
    ("in_mileage" IS NULL OR "in_mileage" >= 0)
  )
);

CREATE UNIQUE INDEX "loaner_checkouts_org_id_unique" ON "loaner_checkouts"("organization_id", "id");
CREATE INDEX "loaner_checkouts_org_open_idx"
  ON "loaner_checkouts"("organization_id", "asset_id") WHERE "checked_in_at" IS NULL;

ALTER TABLE "loaner_checkouts"
  ADD CONSTRAINT "loaner_checkouts_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "loaner_checkouts"
  ADD CONSTRAINT "loaner_checkouts_org_work_order_fk"
  FOREIGN KEY ("organization_id", "work_order_id") REFERENCES "work_orders"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "loaner_checkouts"
  ADD CONSTRAINT "loaner_checkouts_org_asset_fk"
  FOREIGN KEY ("organization_id", "asset_id") REFERENCES "assets"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "sublet_works" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "location_id" UUID NOT NULL,
  "work_order_id" UUID NOT NULL,
  "vendor_name" VARCHAR(180) NOT NULL,
  "description" TEXT NOT NULL,
  "status" VARCHAR(32) NOT NULL DEFAULT 'sent',
  "quoted_minor" BIGINT,
  "actual_minor" BIGINT,
  "sent_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "returned_at" TIMESTAMPTZ(6),
  "note" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "sublet_works_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sublet_status_check" CHECK ("status" IN ('sent', 'returned', 'cancelled')),
  CONSTRAINT "sublet_amounts_check" CHECK (
    ("quoted_minor" IS NULL OR "quoted_minor" >= 0) AND
    ("actual_minor" IS NULL OR "actual_minor" >= 0)
  )
);

CREATE UNIQUE INDEX "sublet_works_org_id_unique" ON "sublet_works"("organization_id", "id");
CREATE INDEX "sublet_works_org_wo_idx" ON "sublet_works"("organization_id", "work_order_id");

ALTER TABLE "sublet_works"
  ADD CONSTRAINT "sublet_works_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sublet_works"
  ADD CONSTRAINT "sublet_works_org_work_order_fk"
  FOREIGN KEY ("organization_id", "work_order_id") REFERENCES "work_orders"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
