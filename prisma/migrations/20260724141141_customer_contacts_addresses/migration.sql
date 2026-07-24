-- Customer contacts (multi-contact support for businesses, fleets, agencies).
CREATE TABLE "customer_contacts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "name" VARCHAR(220) NOT NULL,
    "role" VARCHAR(120),
    "email" VARCHAR(320),
    "phone" VARCHAR(40),
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "customer_contacts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "customer_contacts_org_customer_idx"
  ON "customer_contacts" ("organization_id", "customer_id");

CREATE UNIQUE INDEX "customer_contacts_org_id_unique"
  ON "customer_contacts" ("organization_id", "id");

-- Customer addresses (multi-address: billing, service, corporate, etc.).
CREATE TABLE "customer_addresses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "label" VARCHAR(80) NOT NULL,
    "line_1" VARCHAR(220) NOT NULL,
    "line_2" VARCHAR(220),
    "city" VARCHAR(120) NOT NULL,
    "state_province" VARCHAR(120),
    "postal_code" VARCHAR(20),
    "country" VARCHAR(80) NOT NULL DEFAULT 'US',
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "customer_addresses_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "customer_addresses_org_customer_idx"
  ON "customer_addresses" ("organization_id", "customer_id");

CREATE UNIQUE INDEX "customer_addresses_org_id_unique"
  ON "customer_addresses" ("organization_id", "id");

-- Foreign keys for customer contacts.
ALTER TABLE "customer_contacts"
  ADD CONSTRAINT "customer_contacts_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "customer_contacts"
  ADD CONSTRAINT "customer_contacts_organization_id_customer_id_fkey"
  FOREIGN KEY ("organization_id", "customer_id") REFERENCES "customers"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Foreign keys for customer addresses.
ALTER TABLE "customer_addresses"
  ADD CONSTRAINT "customer_addresses_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "customer_addresses"
  ADD CONSTRAINT "customer_addresses_organization_id_customer_id_fkey"
  FOREIGN KEY ("organization_id", "customer_id") REFERENCES "customers"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
