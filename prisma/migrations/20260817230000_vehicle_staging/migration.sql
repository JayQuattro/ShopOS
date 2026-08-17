-- Vehicle staging: where the customer's vehicle physically is, orthogonal to
-- the work-order workflow. A NULL stage means not staged yet (e.g. before
-- check-in); bay_label names the spot ("Bay 2", "Lift 3").

CREATE TYPE "vehicle_stage" AS ENUM (
  'waiting', 'in_bay', 'on_lift', 'test_drive',
  'waiting_parts', 'ready_for_pickup', 'picked_up'
);

ALTER TABLE "work_orders"
  ADD COLUMN "vehicle_stage" "vehicle_stage",
  ADD COLUMN "bay_label" VARCHAR(60);

CREATE INDEX "work_orders_org_stage_idx"
  ON "work_orders"("organization_id", "vehicle_stage");
