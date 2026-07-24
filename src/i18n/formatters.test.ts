import { describe, expect, it } from "vitest";

import {
  formatDate,
  formatList,
  formatMoney,
  formatNumber,
  formatPercent,
  formatRelativeTime,
} from "@/i18n/formatters";

describe("formatMoney", () => {
  it("formats USD minor units correctly", () => {
    expect(formatMoney(6543, "USD", "en-US")).toBe("$65.43");
  });

  it("formats EUR minor units correctly", () => {
    expect(formatMoney(10000, "EUR", "en-US")).toBe("€100.00");
  });

  it("does not lose precision on large amounts", () => {
    expect(formatMoney(123456789, "USD", "en-US")).toBe("$1,234,567.89");
  });
});

describe("formatDate", () => {
  it("formats a date with the given time zone", () => {
    const result = formatDate("2026-07-24T15:00:00Z", "America/New_York", "en-US");
    expect(result).toMatch(/2026/);
  });
});

describe("formatRelativeTime", () => {
  it("returns 'now' or 'in/future' for the current time", () => {
    const now = new Date("2026-07-24T00:00:00Z");
    const result = formatRelativeTime(now, "en-US", now);
    expect(result).toMatch(/now|in 0/);
  });

  it("returns a past duration for an older date", () => {
    const now = new Date("2026-07-24T00:00:00Z");
    const past = new Date("2026-07-20T00:00:00Z");
    expect(formatRelativeTime(past, "en-US", now)).toContain("day");
  });
});

describe("formatNumber", () => {
  it("formats with locale thousands separators", () => {
    expect(formatNumber(1234567, "en-US")).toBe("1,234,567");
  });
});

describe("formatPercent", () => {
  it("formats a percentage value", () => {
    expect(formatPercent(42.5, "en-US")).toBe("42.5%");
  });
});

describe("formatList", () => {
  it("formats a list with conjunctions", () => {
    expect(formatList(["alpha", "beta", "gamma"], "en-US")).toBe("alpha, beta, and gamma");
  });
});
