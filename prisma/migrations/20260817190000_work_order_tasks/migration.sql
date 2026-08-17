-- Work-order tasks: the technician checklist / inspection sheet. Flagged
-- (NEEDS_ATTENTION) items are the raw material for change orders.

CREATE TYPE "work_order_task_status" AS ENUM (
  'open', 'done', 'needs_attention', 'skipped'
);

CREATE TABLE "work_order_tasks" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "location_id" UUID NOT NULL,
  "work_order_id" UUID NOT NULL,
  "position" INTEGER NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "status" "work_order_task_status" NOT NULL DEFAULT 'open',
  "outcome_note" VARCHAR(500),
  "created_by_user_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "work_order_tasks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "work_order_tasks_position_check" CHECK ("position" > 0)
);

CREATE UNIQUE INDEX "work_order_tasks_org_id_unique" ON "work_order_tasks"("organization_id", "id");
CREATE INDEX "work_order_tasks_org_wo_position_idx"
  ON "work_order_tasks"("organization_id", "work_order_id", "position");

ALTER TABLE "work_order_tasks"
  ADD CONSTRAINT "work_order_tasks_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "work_order_tasks"
  ADD CONSTRAINT "work_order_tasks_org_work_order_fk"
  FOREIGN KEY ("organization_id", "work_order_id") REFERENCES "work_orders"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "work_order_tasks"
  ADD CONSTRAINT "work_order_tasks_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
