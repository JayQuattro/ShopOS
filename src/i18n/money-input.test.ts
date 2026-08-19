import { describe, expect, it } from "vitest";

import { parseMoneyInput } from "./money-input";

describe("parseMoneyInput", () => {
  it("parses dot-decimal conventions (en and friends)", () => {
    expect(parseMoneyInput("150.00")).toBe(15000);
    expect(parseMoneyInput("$1,234.56")).toBe(123456);
    expect(parseMoneyInput("1,234.56")).toBe(123456);
    expect(parseMoneyInput("1,234,567.89")).toBe(123456789);
    expect(parseMoneyInput("0.99")).toBe(99);
    expect(parseMoneyInput("12.5")).toBe(1250);
  });

  it("parses comma-decimal conventions (de, es, it, pt-BR)", () => {
    expect(parseMoneyInput("1.234,56")).toBe(123456);
    expect(parseMoneyInput("1.234.567,89")).toBe(123456789);
    expect(parseMoneyInput("12,5")).toBe(1250);
    expect(parseMoneyInput("0,99")).toBe(99);
    expect(parseMoneyInput("150,00 €")).toBe(15000);
  });

  it("parses space-grouped and bare inputs", () => {
    expect(parseMoneyInput("1 234,56")).toBe(123456); // fr
    expect(parseMoneyInput("1\u00A0234,56")).toBe(123456); // nbsp
    expect(parseMoneyInput("1\u202F234,56")).toBe(123456); // narrow nbsp
    expect(parseMoneyInput("1250")).toBe(125000);
    expect(parseMoneyInput("₹1,50,000.50")).toBe(15000050); // Indian grouping, ₹ symbol
  });

  it("treats a single 3-digit tail as grouping, not decimals", () => {
    // "1.234" is one-thousand-two-hundred-thirty-four in de, and "1,234"
    // is the same in en — the heuristic can satisfy both at once.
    expect(parseMoneyInput("1.234")).toBe(123400);
    expect(parseMoneyInput("1,234")).toBe(123400);
    expect(parseMoneyInput("45.000")).toBe(4500000);
  });

  it("rejects junk and nonsense safely", () => {
    expect(parseMoneyInput("")).toBeNull();
    expect(parseMoneyInput("abc")).toBeNull();
    expect(parseMoneyInput("12,34,56,")).toBeNull(); // trailing separator
    expect(parseMoneyInput("1.2.3.4,5.6")).toBeNull(); // decimals after the decimal
    expect(parseMoneyInput("-5")).toBeNull();
    expect(parseMoneyInput("1..00")).toBeNull();
  });
});
