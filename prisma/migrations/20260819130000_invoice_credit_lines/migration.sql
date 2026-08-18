-- Credit lines on invoices: approved change orders can carry negative lines
-- (part cheaper than quoted, goodwill) which snapshot into invoice_lines, but
-- the original constraint required non-negative amounts — making invoicing a
-- credit-bearing job fail at the database. Mirrors the credit-aware shape the
-- estimate_lines constraint already uses (same migration family as ADR 0014):
-- charge branch unchanged, credit branch requires negative gross, zero
-- discount, non-positive tax. Invoice header: discount stays non-negative and
-- the total equation always holds; subtotal/tax may go negative only via
-- credit lines.

ALTER TABLE "invoice_lines" DROP CONSTRAINT "invoice_lines_values_check";

ALTER TABLE "invoice_lines"
  ADD CONSTRAINT "invoice_lines_values_check" check (
    quantity_milli >= 0
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

ALTER TABLE "invoices" DROP CONSTRAINT "invoices_amounts_check";

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_amounts_check" check (
    discount_minor >= 0
    and total_minor = subtotal_minor - discount_minor + tax_minor
    and paid_minor >= 0
    and paid_minor <= total_minor
  );
