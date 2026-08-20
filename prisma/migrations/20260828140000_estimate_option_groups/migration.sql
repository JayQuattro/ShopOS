-- Estimate option groups: lines that are alternatives of one service
-- (regular vs premium oil change). The customer picks exactly one.
-- Key and label are a denormalized snapshot on each line, matching the
-- revision-snapshot philosophy for presented documents.
ALTER TABLE "estimate_lines"
  ADD COLUMN "option_group_key" VARCHAR(80),
  ADD COLUMN "option_group_label" VARCHAR(160);

ALTER TABLE "estimate_lines"
  ADD CONSTRAINT "estimate_lines_option_group_both_or_neither"
  CHECK (("option_group_key" IS NULL) = ("option_group_label" IS NULL));

CREATE INDEX "estimate_lines_revision_option_group_idx"
  ON "estimate_lines" ("estimate_revision_id", "option_group_key")
  WHERE "option_group_key" IS NOT NULL;
