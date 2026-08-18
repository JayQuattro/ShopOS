-- Key tracking: which key tag goes with which job, and where it lives
-- (hook, lockbox, with a technician). Answers the shop's most-asked
-- question at 5pm. Nullable, additive, no backfill.

ALTER TABLE "work_orders"
  ADD COLUMN "key_tag" VARCHAR(40),
  ADD COLUMN "key_location" VARCHAR(80);
