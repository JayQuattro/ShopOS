-- Tax module (settings roadmap): named tax rates as a catalog over the existing
-- per-line basis points (history stores resolved bps, never a FK — ADR 0004),
-- and shop fees (flat or percent-of-labor) auto-applied as FEE lines at
-- presentation. Both org-scoped.

CREATE TABLE "tax_rates" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "rate_basis_points" INTEGER NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "tax_rates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tax_rates_values_check" CHECK (
    "rate_basis_points" BETWEEN 0 AND 10000 AND "sort_order" >= 0
  )
);

CREATE UNIQUE INDEX "tax_rates_org_id_unique" ON "tax_rates"("organization_id", "id");
CREATE UNIQUE INDEX "tax_rates_org_name_unique" ON "tax_rates"("organization_id", "name");
CREATE INDEX "tax_rates_org_active_idx" ON "tax_rates"("organization_id", "active", "sort_order");

ALTER TABLE "tax_rates"
  ADD CONSTRAINT "tax_rates_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TYPE "shop_fee_calculation" AS ENUM ('flat', 'percent_of_labor');
CREATE TYPE "shop_fee_applies_to" AS ENUM ('baseline', 'change_order', 'both');

CREATE TABLE "shop_fees" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "calculation" "shop_fee_calculation" NOT NULL,
  "amount_minor" BIGINT NOT NULL DEFAULT 0,
  "rate_basis_points" INTEGER NOT NULL DEFAULT 0,
  "max_amount_minor" BIGINT,
  "taxable" BOOLEAN NOT NULL DEFAULT false,
  "tax_rate_basis_points" INTEGER NOT NULL DEFAULT 0,
  "applies_to" "shop_fee_applies_to" NOT NULL DEFAULT 'both',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "shop_fees_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "shop_fees_values_check" CHECK (
    "amount_minor" >= 0 AND
    "rate_basis_points" BETWEEN 0 AND 10000 AND
    ("max_amount_minor" IS NULL OR "max_amount_minor" >= 0) AND
    "tax_rate_basis_points" BETWEEN 0 AND 10000
  )
);

CREATE UNIQUE INDEX "shop_fees_org_id_unique" ON "shop_fees"("organization_id", "id");
CREATE UNIQUE INDEX "shop_fees_org_name_unique" ON "shop_fees"("organization_id", "name");
CREATE INDEX "shop_fees_org_active_idx" ON "shop_fees"("organization_id", "active");

ALTER TABLE "shop_fees"
  ADD CONSTRAINT "shop_fees_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
