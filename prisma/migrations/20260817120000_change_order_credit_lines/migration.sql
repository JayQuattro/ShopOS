-- Change order credit lines (ADR 0014): a line may carry a negative unit
-- price only when the whole line is a credit, and only change-order documents
-- may hold negative totals. The original charge invariants are preserved
-- unchanged in the charge branches; the credit branches additionally require
-- a zero discount and non-positive tax (a tax refund). Service-level guards
-- keep negative prices off baseline revisions.

ALTER TABLE "estimate_lines" DROP CONSTRAINT "estimate_lines_values_check";

ALTER TABLE "estimate_lines"
  ADD CONSTRAINT "estimate_lines_values_check" check (
    quantity_milli >= 0
    and discount_minor >= 0
    and tax_rate_basis_points >= 0
    and total_minor = gross_minor - discount_minor + tax_minor
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
        and gross_minor < 0
        and discount_minor = 0
        and tax_minor <= 0
      )
    )
  );

ALTER TABLE "estimate_revisions" DROP CONSTRAINT "estimate_revisions_amounts_check";

-- Baselines keep the original all-nonnegative invariants. Change orders may
-- net negative; their sign invariants are enforced exactly at the line level,
-- so the document level keeps the total equation and a non-negative discount.
ALTER TABLE "estimate_revisions"
  ADD CONSTRAINT "estimate_revisions_amounts_check" check (
    total_minor = subtotal_minor - discount_minor + tax_minor
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
