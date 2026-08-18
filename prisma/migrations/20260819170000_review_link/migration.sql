-- Review-request deep link (settings roadmap): when set, the close-out review
-- text links the shop's review page instead of only the tracker summary.

ALTER TABLE "organizations"
  ADD COLUMN "review_url" VARCHAR(2048),
  ADD CONSTRAINT "org_review_url_check"
  CHECK ("review_url" IS NULL OR "review_url" ~ '^https?://');
