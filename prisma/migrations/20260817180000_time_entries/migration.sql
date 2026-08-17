-- Time entries: clocked labor against work orders. A null ended_at marks a
-- running timer; the partial unique index enforces one running timer per
-- user per organization at the database level.

CREATE TABLE "time_entries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "location_id" UUID NOT NULL,
  "work_order_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "started_at" TIMESTAMPTZ(6) NOT NULL,
  "ended_at" TIMESTAMPTZ(6),
  "note" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "time_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "time_entries_time_check" CHECK ("ended_at" IS NULL OR "ended_at" > "started_at")
);

CREATE UNIQUE INDEX "time_entries_org_id_unique" ON "time_entries"("organization_id", "id");
CREATE INDEX "time_entries_org_wo_start_idx"
  ON "time_entries"("organization_id", "work_order_id", "started_at");
CREATE INDEX "time_entries_org_user_start_idx"
  ON "time_entries"("organization_id", "user_id", "started_at");
CREATE UNIQUE INDEX "time_entries_one_running_per_user_idx"
  ON "time_entries"("organization_id", "user_id") WHERE "ended_at" IS NULL;

ALTER TABLE "time_entries"
  ADD CONSTRAINT "time_entries_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "time_entries"
  ADD CONSTRAINT "time_entries_org_work_order_fk"
  FOREIGN KEY ("organization_id", "work_order_id") REFERENCES "work_orders"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "time_entries"
  ADD CONSTRAINT "time_entries_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
