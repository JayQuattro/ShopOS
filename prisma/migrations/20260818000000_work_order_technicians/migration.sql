-- Additional (assisting) technicians on a work order. The lead stays on
-- work_orders.assigned_technician_user_id; this join records everyone else
-- who worked the job. Membership is re-validated by the service.

CREATE TABLE "work_order_technicians" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "work_order_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "work_order_technicians_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "work_order_technicians_unique" UNIQUE ("work_order_id", "user_id")
);

CREATE INDEX "work_order_technicians_org_wo_idx"
  ON "work_order_technicians"("organization_id", "work_order_id");

ALTER TABLE "work_order_technicians"
  ADD CONSTRAINT "work_order_technicians_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "work_order_technicians"
  ADD CONSTRAINT "work_order_technicians_org_work_order_fk"
  FOREIGN KEY ("organization_id", "work_order_id") REFERENCES "work_orders"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "work_order_technicians"
  ADD CONSTRAINT "work_order_technicians_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
