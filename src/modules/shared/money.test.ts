import { describe, expect, it } from "vitest";
import {
  calculateEstimate,
  calculateLine,
  currencyCode,
  MoneyError,
  type PricedLineInput,
} from "./money";

const usd = currencyCode("USD");

function line(overrides: Partial<PricedLineInput> = {}): PricedLineInput {
  return {
    id: "line-1",
    kind: "labor",
    quantityMilli: 1_000,
    unitPriceMinor: 10_000,
    discountMinor: 0,
    taxable: true,
    taxRateBasisPoints: 600,
    authorization: "pending",
    ...overrides,
  };
}

describe("money", () => {
  it("calculates labor, discounts, tax, and the approved total in minor units", () => {
    const result = calculateEstimate(usd, [
      line({ id: "labor", authorization: "approved" }),
      line({
        id: "part",
        kind: "part",
        quantityMilli: 2_000,
        unitPriceMinor: 2_500,
        discountMinor: 500,
        taxable: true,
        authorization: "declined",
      }),
      line({
        id: "fee",
        kind: "fee",
        unitPriceMinor: 1_000,
        taxable: false,
        authorization: "not_required",
      }),
    ]);

    expect(result).toMatchObject({
      subtotalMinor: 16_000,
      discountMinor: 500,
      taxMinor: 870,
      totalMinor: 16_370,
      approvedTotalMinor: 11_600,
    });
  });

  it("rounds a fractional quantity half away from zero", () => {
    expect(
      calculateLine(line({ quantityMilli: 125, unitPriceMinor: 100, taxable: false })).grossMinor,
    ).toBe(13);
  });

  it("does not tax non-taxable lines", () => {
    expect(calculateLine(line({ taxable: false })).taxMinor).toBe(0);
  });

  it("rejects a discount larger than the line gross", () => {
    expect(() => calculateLine(line({ discountMinor: 10_001 }))).toThrowError(
      new MoneyError("discount_exceeds_line", "A discount cannot exceed its line gross."),
    );
  });

  it("rejects unsafe numeric inputs", () => {
    expect(() => calculateLine(line({ unitPriceMinor: Number.MAX_SAFE_INTEGER + 1 }))).toThrowError(
      MoneyError,
    );
  });

  it("requires normalized ISO-style currency codes", () => {
    expect(() => currencyCode("usd")).toThrowError(MoneyError);
  });
});
