/**
 * Locale-agnostic money input parsing (ADR 0010 keeps formatting
 * locale-explicit; parsing accepts what users actually type).
 *
 * Conventions vary: "1,234.56" (en), "1.234,56" (de/es/it/pt-BR),
 * "1 234,56" (fr, narrow no-break space), "12,50" (decimal comma), "1250"
 * (bare). The rule: strip currency symbols and spaces; if separators are
 * present, the LAST one is the decimal separator when it is not followed by
 * exactly three digits — otherwise every separator is a thousands separator.
 * Returns integer minor units, or null when the input is not money.
 */

const CURRENCY_SYMBOLS = /[$€£¥₹₽₩﷼]|R\$|Rs\.?/g;
const SEPARATORS = /[.,]/;

export function parseMoneyInput(raw: string): number | null {
  let text = raw.trim().replace(CURRENCY_SYMBOLS, "").trim();
  // French-style grouping uses (narrow no-break) spaces; Brazilian "1.234,56"
  // never carries meaning in the spaces themselves.
  text = text.replace(/[\s\u00A0\u202F]/g, "");
  if (!text || !/^[\d.,]+$/.test(text)) return null;

  const lastSeparator = (() => {
    for (let i = text.length - 1; i >= 0; i--) {
      if (SEPARATORS.test(text[i]!)) return { index: i, char: text[i]! };
    }
    return null;
  })();

  if (text.endsWith(".") || text.endsWith(",")) return null;

  /**
   * Grouping validation: the whole part uses one separator kind and either
   * Western grouping ("1.234.567" — every group after the first is three
   * digits) or Indian grouping ("1,50,000" — the last group is three and
   * the intermediate groups are two). Mixed forms are rejected.
   */
  function wholeIsValid(whole: string): boolean {
    if (whole === "") return true;
    if (!/^\d+(([.,])\d+)*$/.test(whole)) return false;
    const marks = whole.match(/[.,]/g) ?? [];
    if (new Set(marks).size > 1) return false;
    const groups = whole.split(/[.,]/);
    const tails = groups.slice(1);
    const western = tails.every((group) => /^\d{3}$/.test(group));
    const indian =
      tails.length > 0 &&
      /^\d{3}$/.test(tails[tails.length - 1]!) &&
      tails.slice(0, -1).every((group) => /^\d{2}$/.test(group));
    return western || indian;
  }

  let normalized: string;
  if (!lastSeparator) {
    normalized = text; // bare integer
  } else {
    const decimals = text.slice(lastSeparator.index + 1);
    const isDecimal = decimals.length !== 3;
    if (isDecimal) {
      // The last separator is the decimal mark; the whole part may still
      // carry grouping ("1.234,56" → whole "1.234").
      const whole = text.slice(0, lastSeparator.index);
      if (!wholeIsValid(whole) || whole === "") return null;
      const wholeDigits = whole.replace(/[.,]/g, "");
      const fraction = decimals.padEnd(2, "0").slice(0, 2);
      normalized = `${wholeDigits}.${fraction}`;
    } else {
      // All separators are grouping: "1.234", "1,234,567", "1.234.567".
      if (!wholeIsValid(text)) return null;
      normalized = text.replace(/[.,]/g, "");
    }
  }

  const major = Number(normalized);
  if (!Number.isFinite(major) || major < 0) return null;
  const minor = Math.round(major * 100);
  return Number.isSafeInteger(minor) ? minor : null;
}
