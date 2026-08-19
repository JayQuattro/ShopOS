-- Regional settings: organization defaults with per-location overrides.
-- Locale drives customer-facing formatting (prints, statements); currency
-- is the default for new money records at that location. Null = inherit
-- the organization default; the org locale falls back to en-US.

ALTER TABLE "organizations" ADD COLUMN "default_locale" VARCHAR(12);

ALTER TABLE "locations" ADD COLUMN "currency" VARCHAR(3);
ALTER TABLE "locations" ADD COLUMN "locale" VARCHAR(12);

ALTER TABLE "locations"
  ADD CONSTRAINT "locations_currency_iso_check" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "locations"
  ADD CONSTRAINT "locations_locale_shape_check" CHECK ("locale" ~ '^[a-z]{2,3}(-[A-Z][a-zA-Z]{0,7})*$');
ALTER TABLE "organizations"
  ADD CONSTRAINT "organizations_default_locale_shape_check"
  CHECK ("default_locale" ~ '^[a-z]{2,3}(-[A-Z][a-zA-Z]{0,7})*$');
