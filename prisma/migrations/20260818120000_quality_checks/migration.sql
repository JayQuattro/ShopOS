-- Final quality control: a configurable checklist gate before a work order can
-- complete, with who passed it and when. Organizations choose whether QC is
-- required (default: required) — the check items themselves come from the
-- service-menu templates' task lists via the normal checklist flow.

ALTER TABLE "work_orders"
  ADD COLUMN "qc_status" VARCHAR(32) NOT NULL DEFAULT 'pending',
  ADD COLUMN "qc_note" TEXT,
  ADD COLUMN "qc_passed_by_user_id" UUID,
  ADD COLUMN "qc_passed_at" TIMESTAMPTZ(6);

ALTER TABLE "work_orders"
  ADD CONSTRAINT "work_orders_qc_status_check"
  CHECK ("qc_status" IN ('pending', 'passed', 'failed'));

ALTER TABLE "work_orders"
  ADD CONSTRAINT "work_orders_qc_consistency_check"
  CHECK (
    ("qc_status" = 'pending') = ("qc_passed_at" IS NULL AND "qc_passed_by_user_id" IS NULL)
  );

ALTER TABLE "work_orders"
  ADD CONSTRAINT "work_orders_qc_passed_by_user_id_fkey"
  FOREIGN KEY ("qc_passed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "organizations"
  ADD COLUMN "quality_check_required" BOOLEAN NOT NULL DEFAULT true;
