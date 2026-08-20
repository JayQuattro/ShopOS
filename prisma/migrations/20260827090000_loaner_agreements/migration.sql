-- Loaner check-out agreements: fuel level and condition at hand-off, plus
-- the customer's recorded acknowledgment. The checkout is the agreement —
-- walkaround notes settle damage and fuel disputes; the acknowledgment
-- timestamps who agreed at hand-off.

ALTER TABLE "loaner_checkouts"
  ADD COLUMN "fuel_out" INTEGER,
  ADD COLUMN "condition_note" TEXT,
  ADD COLUMN "acknowledged_by" VARCHAR(180),
  ADD COLUMN "acknowledged_at" TIMESTAMPTZ(6);

ALTER TABLE "loaner_checkouts"
  ADD CONSTRAINT "loaner_fuel_check" CHECK ("fuel_out" IS NULL OR ("fuel_out" >= 0 AND "fuel_out" <= 100));
