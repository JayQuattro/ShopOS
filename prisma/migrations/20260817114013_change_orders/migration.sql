-- Change orders and supplemental authorization (ADR 0014).
-- Additive only: new enum types and values, new columns with tenant-safe
-- defaults, a pending-CO lookup index, and a partial unique index Prisma
-- cannot express for per-work-order change order numbering.

CREATE TYPE "estimate_document_kind" AS ENUM ('baseline', 'change_order');
CREATE TYPE "change_order_credit_policy" AS ENUM ('auto_apply', 'require_approval');
CREATE TYPE "invoice_line_policy" AS ENUM ('approved_only', 'all_lines');

ALTER TYPE "authorization_method" ADD VALUE IF NOT EXISTS 'system';
ALTER TYPE "estimate_revision_status" ADD VALUE IF NOT EXISTS 'voided';

ALTER TABLE "estimate_revisions"
  ADD COLUMN "document_kind" "estimate_document_kind" NOT NULL DEFAULT 'baseline',
  ADD COLUMN "change_order_number" INTEGER,
  ADD COLUMN "summary_note" VARCHAR(1000);

ALTER TABLE "organizations"
  ADD COLUMN "change_order_credit_policy" "change_order_credit_policy" NOT NULL DEFAULT 'auto_apply',
  ADD COLUMN "invoice_line_policy" "invoice_line_policy" NOT NULL DEFAULT 'approved_only';

CREATE INDEX "estimate_revisions_org_wo_kind_status_idx"
  ON "estimate_revisions"("organization_id", "work_order_id", "document_kind", "status");

CREATE UNIQUE INDEX "estimate_revisions_wo_change_order_number_idx"
  ON "estimate_revisions"("work_order_id", "change_order_number")
  WHERE "change_order_number" IS NOT NULL;
