-- Display label for the existing service_group_key grouping on estimate
-- lines ("Front brakes", "Tune up"). Presentation only: the key has always
-- been the grouping identity; the label rides along for rendering.
ALTER TABLE "estimate_lines" ADD COLUMN "service_group_label" VARCHAR(160);
