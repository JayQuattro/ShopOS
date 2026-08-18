-- Deposits taken at drop-off, before any invoice exists. Applying a deposit
-- to its work order's issued invoice records the payment (so AR balances and
-- the cash drawer stay money-truthful) and stamps the deposit as applied.

CREATE TABLE "deposits" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "location_id" UUID NOT NULL,
  "work_order_id" UUID NOT NULL,
  "amount_minor" BIGINT NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "method" "payment_method" NOT NULL,
  "reference" VARCHAR(160),
  "received_at" TIMESTAMPTZ(6) NOT NULL,
  "recorded_by_user_id" UUID NOT NULL,
  "applied_invoice_id" UUID,
  "applied_at" TIMESTAMPTZ(6),
  "note" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "deposits_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "deposit_amount_check" CHECK ("amount_minor" > 0),
  CONSTRAINT "deposit_applied_state_check" CHECK (
    ("applied_invoice_id" IS NULL AND "applied_at" IS NULL) OR
    ("applied_invoice_id" IS NOT NULL AND "applied_at" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "deposits_org_id_unique" ON "deposits"("organization_id", "id");
CREATE INDEX "deposits_org_work_order_idx" ON "deposits"("organization_id", "work_order_id");
CREATE INDEX "deposits_org_open_idx" ON "deposits"("organization_id") WHERE "applied_at" IS NULL;

ALTER TABLE "deposits"
  ADD CONSTRAINT "deposits_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "deposits"
  ADD CONSTRAINT "deposits_org_location_fk"
  FOREIGN KEY ("organization_id", "location_id") REFERENCES "locations"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "deposits"
  ADD CONSTRAINT "deposits_org_work_order_fk"
  FOREIGN KEY ("organization_id", "work_order_id") REFERENCES "work_orders"("organization_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "deposits"
  ADD CONSTRAINT "deposits_recorded_by_fk"
  FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
