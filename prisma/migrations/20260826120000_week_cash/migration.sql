-- Week start (0=Sunday, 1=Monday ISO) for schedule/report grouping; org
-- default. Cash rounding unit in minor units for till convenience —
-- 5 for the Canadian nickel, 100 for whole-krona SEK, 500 for
-- five-rappen CHF; 0 disables. Location override for rounding (a border
-- town), org-level for week start.

ALTER TABLE "organizations"
  ADD COLUMN "week_starts_on" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "organizations"
  ADD CONSTRAINT "organizations_week_start_check"
  CHECK ("week_starts_on" IN (0, 1));

ALTER TABLE "locations" ADD COLUMN "cash_rounding_minor" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "locations"
  ADD CONSTRAINT "locations_cash_rounding_check"
  CHECK ("cash_rounding_minor" IN (0, 1, 5, 10, 25, 50, 100, 500, 1000));
