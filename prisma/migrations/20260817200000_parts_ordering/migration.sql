-- Parts ordering (ADR 0015): a local, tenant-owned ledger of what was ordered,
-- from whom, at what cost, and whether it arrived. Source/external_order_id are
-- the seam for future parts-supplier connectors; manual ordering works without
-- any external provider.

CREATE TYPE "part_order_status" AS ENUM ('requested', 'ordered', 'received', 'cancelled');
CREATE TYPE "part_order_source" AS ENUM ('manual', 'connector');

CREATE TABLE "part_suppliers" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "name" VARCHAR(180) NOT NULL,
  "phone" VARCHAR(40),
  "email" VARCHAR(320),
  "website" VARCHAR(2048),
  "notes" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "part_suppliers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "part_suppliers_org_id_unique" ON "part_suppliers"("organization_id", "id");
CREATE UNIQUE INDEX "part_suppliers_org_name_unique" ON "part_suppliers"("organization_id", "name");
CREATE INDEX "part_suppliers_org_active_idx" ON "part_suppliers"("organization_id", "active");

ALTER TABLE "part_suppliers"
  ADD CONSTRAINT "part_suppliers_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "part_orders" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "location_id" UUID NOT NULL,
  "work_order_id" UUID NOT NULL,
  "supplier_id" UUID NOT NULL,
  "status" "part_order_status" NOT NULL DEFAULT 'requested',
  "source" "part_order_source" NOT NULL DEFAULT 'manual',
  "external_order_id" VARCHAR(180),
  "currency" VARCHAR(3) NOT NULL,
  "tracking_number" VARCHAR(180),
  "note" TEXT,
  "ordered_at" TIMESTAMPTZ(6),
  "received_at" TIMESTAMPTZ(6),
  "created_by_user_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "part_orders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "part_orders_currency_check" CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT "part_orders_receipt_check" CHECK (
    (status <> 'received' AND received_at IS NULL)
    OR (status = 'received' AND received_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "part_orders_org_id_unique" ON "part_orders"("organization_id", "id");
CREATE INDEX "part_orders_org_wo_idx" ON "part_orders"("organization_id", "work_order_id");
CREATE INDEX "part_orders_org_status_idx" ON "part_orders"("organization_id", "status");

ALTER TABLE "part_orders"
  ADD CONSTRAINT "part_orders_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "part_orders"
  ADD CONSTRAINT "part_orders_org_work_order_fk"
  FOREIGN KEY ("organization_id", "work_order_id") REFERENCES "work_orders"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "part_orders"
  ADD CONSTRAINT "part_orders_org_supplier_fk"
  FOREIGN KEY ("organization_id", "supplier_id") REFERENCES "part_suppliers"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "part_orders"
  ADD CONSTRAINT "part_orders_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "part_order_lines" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "part_order_id" UUID NOT NULL,
  "description" TEXT NOT NULL,
  "part_number" VARCHAR(120),
  "quantity" INTEGER NOT NULL,
  "received_quantity" INTEGER NOT NULL DEFAULT 0,
  "unit_cost_minor" BIGINT NOT NULL,
  "note" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "part_order_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "part_order_lines_quantity_check" CHECK (
    quantity > 0 AND received_quantity >= 0 AND received_quantity <= quantity
  ),
  CONSTRAINT "part_order_lines_cost_check" CHECK (unit_cost_minor >= 0)
);

CREATE UNIQUE INDEX "part_order_lines_org_id_unique" ON "part_order_lines"("organization_id", "id");
CREATE INDEX "part_order_lines_org_order_idx" ON "part_order_lines"("organization_id", "part_order_id");

ALTER TABLE "part_order_lines"
  ADD CONSTRAINT "part_order_lines_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "part_order_lines"
  ADD CONSTRAINT "part_order_lines_org_part_order_fk"
  FOREIGN KEY ("organization_id", "part_order_id") REFERENCES "part_orders"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
