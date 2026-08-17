-- Technician assignment on work orders: the shop's day starts with knowing
-- who is working on what. Single primary technician; the assignee must be an
-- organization member (enforced by the service, which resolves membership).

ALTER TABLE "work_orders"
  ADD COLUMN "assigned_technician_user_id" UUID;

CREATE INDEX "work_orders_org_assignee_idx"
  ON "work_orders"("organization_id", "assigned_technician_user_id");

ALTER TABLE "work_orders"
  ADD CONSTRAINT "work_orders_assigned_technician_user_id_fkey"
  FOREIGN KEY ("assigned_technician_user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
