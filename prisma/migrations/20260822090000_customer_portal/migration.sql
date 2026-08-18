-- Customer portal login: a Better Auth user may be linked to customer
-- records (one per organization) to see their own jobs, invoices, and
-- statements. The link is an identity hint resolved server-side on every
-- request; it never grants organization membership or staff permissions.

ALTER TABLE "customers" ADD COLUMN "portal_user_id" UUID;

CREATE INDEX "customers_portal_user_idx" ON "customers"("portal_user_id") WHERE "portal_user_id" IS NOT NULL;

ALTER TABLE "customers"
  ADD CONSTRAINT "customers_portal_user_fk"
  FOREIGN KEY ("portal_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
