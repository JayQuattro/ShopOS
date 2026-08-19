-- Payment links on invoices: the URL is a provider projection stored for
-- display (portal "pay now", reprint); the invoice stays the source of truth
-- for amounts. payment_link_ref matches signed webhook events to the invoice.

ALTER TABLE "invoices"
  ADD COLUMN "payment_url" VARCHAR(2048),
  ADD COLUMN "payment_link_ref" VARCHAR(160);
