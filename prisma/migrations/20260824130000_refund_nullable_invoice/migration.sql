-- Field-collection refunds have no invoice to point at.

ALTER TABLE "refunds" ALTER COLUMN "invoice_id" DROP NOT NULL;
