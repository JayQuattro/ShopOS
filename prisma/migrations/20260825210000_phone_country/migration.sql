-- Configurable phone country: the default ISO 3166-1 alpha-2 country used
-- to normalize typed phone numbers to E.164. Org default, location
-- override — a Canadian location of a US shop normalizes local numbers
-- against +1 either way, but a Portuguese location of a Spanish org
-- needs its own.

ALTER TABLE "organizations" ADD COLUMN "default_phone_country" VARCHAR(2);

ALTER TABLE "locations" ADD COLUMN "phone_country" VARCHAR(2);

ALTER TABLE "organizations"
  ADD CONSTRAINT "organizations_phone_country_shape_check"
  CHECK ("default_phone_country" ~ '^[A-Z]{2}$');

ALTER TABLE "locations"
  ADD CONSTRAINT "locations_phone_country_shape_check"
  CHECK ("phone_country" ~ '^[A-Z]{2}$');
