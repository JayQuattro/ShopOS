-- Photos on estimate lines: the highest-converting approval surface.
-- Attachments may anchor to one estimate line so the customer sees the
-- scored rotor next to the approve button for that line.

ALTER TABLE "work_order_attachments" ADD COLUMN "estimate_line_id" UUID;

ALTER TABLE "work_order_attachments"
  ADD CONSTRAINT "attachments_org_estimate_line_fk"
  FOREIGN KEY ("organization_id", "estimate_line_id")
  REFERENCES "estimate_lines"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "attachments_org_estimate_line_idx"
  ON "work_order_attachments"("organization_id", "estimate_line_id")
  WHERE "estimate_line_id" IS NOT NULL;
