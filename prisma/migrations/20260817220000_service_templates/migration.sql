-- Service menu templates: saved jobs (priced lines) and inspection sheets
-- (task lists) applied to a work order in one tap. Template lines are copy
-- sources, not financial records — applied lines are priced into the draft
-- revision through the money kernel as usual.

CREATE TABLE "service_templates" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "name" VARCHAR(180) NOT NULL,
  "notes" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "service_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "service_templates_org_id_unique" ON "service_templates"("organization_id", "id");
CREATE UNIQUE INDEX "service_templates_org_name_unique" ON "service_templates"("organization_id", "name");

ALTER TABLE "service_templates"
  ADD CONSTRAINT "service_templates_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "service_template_lines" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "service_template_id" UUID NOT NULL,
  "position" INTEGER NOT NULL,
  "kind" "priced_line_kind" NOT NULL,
  "service_group_key" VARCHAR(80) NOT NULL,
  "description" TEXT NOT NULL,
  "quantity_milli" INTEGER NOT NULL,
  "unit_price_minor" BIGINT NOT NULL,
  "taxable" BOOLEAN NOT NULL,
  "tax_rate_basis_points" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "service_template_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "service_template_lines_values_check" CHECK (
    position > 0 AND quantity_milli > 0 AND unit_price_minor >= 0 AND tax_rate_basis_points >= 0
  )
);

CREATE UNIQUE INDEX "service_template_lines_org_id_unique" ON "service_template_lines"("organization_id", "id");
CREATE INDEX "service_template_lines_org_template_idx" ON "service_template_lines"("organization_id", "service_template_id");

ALTER TABLE "service_template_lines"
  ADD CONSTRAINT "service_template_lines_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "service_template_lines"
  ADD CONSTRAINT "service_template_lines_org_template_fk"
  FOREIGN KEY ("organization_id", "service_template_id") REFERENCES "service_templates"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "service_template_tasks" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "service_template_id" UUID NOT NULL,
  "position" INTEGER NOT NULL,
  "title" VARCHAR(200) NOT NULL,

  CONSTRAINT "service_template_tasks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "service_template_tasks_position_check" CHECK (position > 0)
);

CREATE UNIQUE INDEX "service_template_tasks_org_id_unique" ON "service_template_tasks"("organization_id", "id");
CREATE INDEX "service_template_tasks_org_template_idx" ON "service_template_tasks"("organization_id", "service_template_id");

ALTER TABLE "service_template_tasks"
  ADD CONSTRAINT "service_template_tasks_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "service_template_tasks"
  ADD CONSTRAINT "service_template_tasks_org_template_fk"
  FOREIGN KEY ("organization_id", "service_template_id") REFERENCES "service_templates"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;


