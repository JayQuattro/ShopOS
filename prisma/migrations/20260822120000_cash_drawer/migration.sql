-- Cash drawer sessions: the nightly close-out. One open session per shop
-- location; payments already recorded in the window are totaled by method
-- at close, cash is counted, and over/short is kept for reconciliation.

CREATE TABLE "cash_drawer_sessions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "location_id" UUID NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "opening_float_minor" INTEGER NOT NULL DEFAULT 0,
  "status" VARCHAR(16) NOT NULL DEFAULT 'open',
  "method_totals" JSONB NOT NULL DEFAULT '{}',
  "counted_cash_minor" INTEGER,
  "expected_cash_minor" INTEGER,
  "over_short_minor" INTEGER,
  "opened_by_user_id" UUID NOT NULL,
  "opened_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closed_by_user_id" UUID,
  "closed_at" TIMESTAMPTZ(6),
  "note" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "cash_drawer_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "cash_drawer_status_check" CHECK ("status" IN ('open', 'closed')),
  CONSTRAINT "cash_drawer_closed_state_check" CHECK (
    ("status" = 'open' AND "closed_at" IS NULL AND "closed_by_user_id" IS NULL) OR
    ("status" = 'closed' AND "closed_at" IS NOT NULL AND "closed_by_user_id" IS NOT NULL AND
     "counted_cash_minor" IS NOT NULL AND "expected_cash_minor" IS NOT NULL AND "over_short_minor" IS NOT NULL)
  ),
  CONSTRAINT "cash_drawer_amounts_check" CHECK (
    "opening_float_minor" >= 0 AND
    ("counted_cash_minor" IS NULL OR "counted_cash_minor" >= 0)
  )
);

CREATE UNIQUE INDEX "cash_drawer_org_id_unique" ON "cash_drawer_sessions"("organization_id", "id");
CREATE INDEX "cash_drawer_org_location_status_idx" ON "cash_drawer_sessions"("organization_id", "location_id", "status");

-- Only one open drawer per location at a time.
CREATE UNIQUE INDEX "cash_drawer_one_open_per_location"
  ON "cash_drawer_sessions"("organization_id", "location_id") WHERE "status" = 'open';

ALTER TABLE "cash_drawer_sessions"
  ADD CONSTRAINT "cash_drawer_sessions_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "cash_drawer_sessions"
  ADD CONSTRAINT "cash_drawer_sessions_org_location_fk"
  FOREIGN KEY ("organization_id", "location_id") REFERENCES "locations"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "cash_drawer_sessions"
  ADD CONSTRAINT "cash_drawer_sessions_opened_by_fk"
  FOREIGN KEY ("opened_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "cash_drawer_sessions"
  ADD CONSTRAINT "cash_drawer_sessions_closed_by_fk"
  FOREIGN KEY ("closed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
