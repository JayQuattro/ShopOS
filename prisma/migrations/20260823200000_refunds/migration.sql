-- Refunds: money returned against a payment. Payment rows stay immutable;
-- refunds are separate rows and the invoice's paid amount is tracked net of
-- refunds, so AR balances stay truthful. processor_charge_id links a webhook
-- payment to its Stripe PaymentIntent for processor-side refunds.

ALTER TABLE "payments" ADD COLUMN "processor_charge_id" VARCHAR(120);

CREATE UNIQUE INDEX "payments_org_id_unique" ON "payments"("organization_id", "id");

CREATE TABLE "refunds" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "location_id" UUID NOT NULL,
  "invoice_id" UUID NOT NULL,
  "payment_id" UUID NOT NULL,
  "amount_minor" BIGINT NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "reason" VARCHAR(500),
  "provider_ref" VARCHAR(160),
  "refunded_at" TIMESTAMPTZ(6) NOT NULL,
  "recorded_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "refunds_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "refund_amount_check" CHECK ("amount_minor" > 0)
);

CREATE UNIQUE INDEX "refunds_org_id_unique" ON "refunds"("organization_id", "id");
CREATE INDEX "refunds_org_invoice_idx" ON "refunds"("organization_id", "invoice_id");
CREATE INDEX "refunds_org_payment_idx" ON "refunds"("organization_id", "payment_id");

ALTER TABLE "refunds"
  ADD CONSTRAINT "refunds_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "refunds"
  ADD CONSTRAINT "refunds_org_location_fk"
  FOREIGN KEY ("organization_id", "location_id") REFERENCES "locations"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "refunds"
  ADD CONSTRAINT "refunds_org_invoice_fk"
  FOREIGN KEY ("organization_id", "invoice_id") REFERENCES "invoices"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "refunds"
  ADD CONSTRAINT "refunds_org_payment_fk"
  FOREIGN KEY ("organization_id", "payment_id") REFERENCES "payments"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "refunds"
  ADD CONSTRAINT "refunds_recorded_by_fk"
  FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

