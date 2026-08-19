-- VAT-inclusive pricing: the org chooses whether entered prices already
-- contain tax (VAT countries) or have it added on top (US-style).
-- Documents snapshot their mode so history never re-interprets itself.

ALTER TABLE "organizations"
  ADD COLUMN "tax_display_mode" VARCHAR(12) NOT NULL DEFAULT 'EXCLUSIVE';

ALTER TABLE "organizations"
  ADD CONSTRAINT "organizations_tax_display_mode_check"
  CHECK ("tax_display_mode" IN ('EXCLUSIVE', 'INCLUSIVE'));

ALTER TABLE "estimate_revisions" ADD COLUMN "tax_inclusive" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "invoices" ADD COLUMN "tax_inclusive" BOOLEAN NOT NULL DEFAULT false;

-- Line-level snapshots so the stored identity constraint can be mode-aware:
-- inclusive lines total their net (tax lives inside it), exclusive lines
-- total net + tax.

ALTER TABLE "estimate_lines" ADD COLUMN "tax_inclusive" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "invoice_lines" ADD COLUMN "tax_inclusive" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "estimate_lines" DROP CONSTRAINT "estimate_lines_values_check";
ALTER TABLE "estimate_lines"
  ADD CONSTRAINT "estimate_lines_values_check" check (
    quantity_milli >= 0
    and discount_minor >= 0
    and tax_rate_basis_points >= 0
    and total_minor = gross_minor - discount_minor
      + (case when tax_inclusive then 0 else tax_minor end)
    and (
      (
        unit_price_minor >= 0
        and gross_minor >= 0
        and discount_minor <= gross_minor
        and tax_minor >= 0
      )
      or
      (
        unit_price_minor < 0
        and gross_minor <= 0
        and discount_minor = 0
        and tax_minor <= 0
      )
    )
  );

ALTER TABLE "invoice_lines" DROP CONSTRAINT "invoice_lines_values_check";
ALTER TABLE "invoice_lines"
  ADD CONSTRAINT "invoice_lines_values_check" check (
    quantity_milli >= 0
    and discount_minor >= 0
    and tax_rate_basis_points >= 0
    and total_minor = gross_minor - discount_minor
      + (case when tax_inclusive then 0 else tax_minor end)
    and (
      (
        unit_price_minor >= 0
        and gross_minor >= 0
        and discount_minor <= gross_minor
        and tax_minor >= 0
      )
      or
      (
        unit_price_minor < 0
        and gross_minor <= 0
        and discount_minor = 0
        and tax_minor <= 0
      )
    )
  );


-- Header-level identity: inclusive documents total net (tax inside),
-- exclusive documents total net + tax.

ALTER TABLE "estimate_revisions" DROP CONSTRAINT "estimate_revisions_amounts_check";
ALTER TABLE "estimate_revisions"
  ADD CONSTRAINT "estimate_revisions_amounts_check" check (
    total_minor = subtotal_minor - discount_minor
      + (case when tax_inclusive then 0 else tax_minor end)
    and (
      (
        document_kind = 'baseline'
        and subtotal_minor >= 0
        and discount_minor >= 0
        and discount_minor <= subtotal_minor
        and tax_minor >= 0
      )
      or
      (
        document_kind = 'change_order'
        and discount_minor >= 0
      )
    )
  );

ALTER TABLE "invoices" DROP CONSTRAINT "invoices_amounts_check";
ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_amounts_check" check (
    subtotal_minor >= 0
    and discount_minor >= 0
    and discount_minor <= subtotal_minor
    and tax_minor >= 0
    and total_minor = subtotal_minor - discount_minor
      + (case when tax_inclusive then 0 else tax_minor end)
    and paid_minor >= 0
  );
