-- Document-scoped evidence attachments (ADR 0014 follow-up): an attachment
-- may be linked to the estimate revision it evidences, which is what customer
-- authorization links are allowed to serve. Work-order-wide attachments keep
-- a NULL estimate_revision_id and are never exposed through a link token.

ALTER TABLE "work_order_attachments"
  ADD COLUMN "estimate_revision_id" UUID;

CREATE INDEX "work_order_attachments_org_revision_idx"
  ON "work_order_attachments"("organization_id", "estimate_revision_id");

ALTER TABLE "work_order_attachments"
  ADD CONSTRAINT "work_order_attachments_org_revision_fk"
  FOREIGN KEY ("organization_id", "estimate_revision_id")
  REFERENCES "estimate_revisions"("organization_id", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;
