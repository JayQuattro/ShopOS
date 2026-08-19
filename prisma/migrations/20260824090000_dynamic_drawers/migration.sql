-- Dynamic drawers: a till belongs to a cashier (owner) or is the shared
-- house drawer. One open shared drawer per location, one open personal
-- till per owner per location; both can coexist. Payments are stamped with
-- the drawer they landed in at record time so over/short is attributable —
-- unstamped payments (recorded before this change, or processor webhooks
-- with no open drawer) reconcile to the shared drawer's window.

ALTER TABLE "cash_drawer_sessions"
  ADD COLUMN "owner_user_id" UUID,
  ADD COLUMN "label" VARCHAR(80);

DROP INDEX "cash_drawer_one_open_per_location";

CREATE UNIQUE INDEX "cash_drawer_one_shared_per_location"
  ON "cash_drawer_sessions"("organization_id", "location_id")
  WHERE "status" = 'open' AND "owner_user_id" IS NULL;

CREATE UNIQUE INDEX "cash_drawer_one_open_per_owner"
  ON "cash_drawer_sessions"("organization_id", "location_id", "owner_user_id")
  WHERE "status" = 'open' AND "owner_user_id" IS NOT NULL;

ALTER TABLE "cash_drawer_sessions"
  ADD CONSTRAINT "cash_drawer_sessions_owner_fk"
  FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payments" ADD COLUMN "drawer_session_id" UUID;

CREATE INDEX "payments_org_drawer_idx"
  ON "payments"("organization_id", "drawer_session_id") WHERE "drawer_session_id" IS NOT NULL;

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_org_drawer_fk"
  FOREIGN KEY ("organization_id", "drawer_session_id")
  REFERENCES "cash_drawer_sessions"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
