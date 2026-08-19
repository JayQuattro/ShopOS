-- Field collections: money taken on a roadside job with no invoice. A
-- payment may now be anchored to a service call instead of an invoice
-- (invoice_id becomes nullable); AR never sees invoice-less payments, but
-- the tech's till and the day's totals count them like any other money.

ALTER TABLE "payments" ALTER COLUMN "invoice_id" DROP NOT NULL;

ALTER TABLE "payments" ADD COLUMN "service_call_id" UUID;

CREATE INDEX "payments_org_service_call_idx"
  ON "payments"("organization_id", "service_call_id") WHERE "service_call_id" IS NOT NULL;

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_org_service_call_fk"
  FOREIGN KEY ("organization_id", "service_call_id")
  REFERENCES "service_calls"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

