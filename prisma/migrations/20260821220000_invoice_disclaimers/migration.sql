-- Canned disclaimer library with contextual suggestion triggers, and the
-- per-invoice snapshot of applied disclaimers. Snapshots are frozen into
-- the invoice document at apply time (name + body copied), so later edits
-- to the library never rewrite issued history.

CREATE TYPE "disclaimer_trigger" AS ENUM ('customer_parts', 'sublet');

CREATE TABLE "disclaimer_templates" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "body" VARCHAR(2000) NOT NULL,
  "trigger_key" "disclaimer_trigger",
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "disclaimer_templates_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "disclaimer_templates"
    ADD CONSTRAINT "disclaimer_templates_org_fk"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX "disclaimer_templates_org_name_unique"
  ON "disclaimer_templates"("organization_id", "name");

CREATE UNIQUE INDEX "disclaimer_templates_org_id_unique"
  ON "disclaimer_templates"("organization_id", "id");

CREATE INDEX "disclaimer_templates_org_active_idx"
  ON "disclaimer_templates"("organization_id", "active");

CREATE TABLE "invoice_disclaimers" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "invoice_id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "body" VARCHAR(2000) NOT NULL,
  "position" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "invoice_disclaimers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "invoice_disclaimers_position_check" CHECK ("position" > 0)
);

DO $$ BEGIN
  ALTER TABLE "invoice_disclaimers"
    ADD CONSTRAINT "invoice_disclaimers_org_fk"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
  ALTER TABLE "invoice_disclaimers"
    ADD CONSTRAINT "invoice_disclaimers_org_invoice_fk"
    FOREIGN KEY ("organization_id", "invoice_id")
    REFERENCES "invoices"("organization_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX "invoice_disclaimers_org_id_unique"
  ON "invoice_disclaimers"("organization_id", "id");

CREATE UNIQUE INDEX "invoice_disclaimers_invoice_position_unique"
  ON "invoice_disclaimers"("invoice_id", "position");

CREATE INDEX "invoice_disclaimers_org_invoice_idx"
  ON "invoice_disclaimers"("organization_id", "invoice_id");
