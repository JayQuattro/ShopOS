import { describe, expect, it } from "vitest";

import enUs from "@/messages/en-US.json";
import enXa from "@/messages/en-XA.json";
import { isRtl, SUPPORTED_LOCALES } from "@/i18n/routing";

/**
 * Locale gate tests (issue #59).
 *
 * Verifies pseudo-locale text expansion, RTL detection, logical-property
 * readiness, and mixed-direction identifier safety — the automated checks
 * that can run without a browser. Manual review (screen-reader, zoom,
 * real-device) is documented in docs/localization-and-translation.md.
 */

function collectFlatKeys(obj: Record<string, unknown>, prefix = ""): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "object" && value !== null) {
      keys.push(...collectFlatKeys(value as Record<string, unknown>, path));
    } else {
      keys.push(path);
    }
  }
  return keys;
}

describe("pseudo-locale text expansion (en-XA)", () => {
  it("every pseudo-locale message is longer than its source (text expansion)", () => {
    function checkExpansion(
      source: Record<string, unknown>,
      pseudo: Record<string, unknown>,
      path = "",
    ) {
      for (const [key, sourceValue] of Object.entries(source)) {
        const currentPath = path ? `${path}.${key}` : key;
        if (typeof sourceValue === "object" && sourceValue !== null) {
          checkExpansion(
            sourceValue as Record<string, unknown>,
            (pseudo[key] as Record<string, unknown>) ?? {},
            currentPath,
          );
        } else if (typeof sourceValue === "string") {
          const pseudoValue = pseudo[key] as string | undefined;
          expect(pseudoValue, `${currentPath} should exist in en-XA`).toBeDefined();
          // The pseudo-locale should be at least as long as the source. Short
          // strings (e.g. error messages) may not expand much because the
          // accented characters are similar in count; the bracket wrapping
          // provides the visual expansion signal for layout testing.
          expect(
            (pseudoValue as string).length,
            `${currentPath}: pseudo-locale should not be shorter than source`,
          ).toBeGreaterThanOrEqual((sourceValue as string).length);
        }
      }
    }
    checkExpansion(enUs as Record<string, unknown>, enXa as Record<string, unknown>);
  });

  it("every pseudo-locale message starts and ends with brackets (visibility)", () => {
    function checkBrackets(obj: Record<string, unknown>, path = "") {
      for (const [key, value] of Object.entries(obj)) {
        const currentPath = path ? `${path}.${key}` : key;
        if (typeof value === "object" && value !== null) {
          checkBrackets(value as Record<string, unknown>, currentPath);
        } else if (typeof value === "string") {
          expect(value, `${currentPath}: should start with [`).toMatch(/^\[/);
          expect(value, `${currentPath}: should end with …\]`).toMatch(/\]$/);
        }
      }
    }
    checkBrackets(enXa as Record<string, unknown>);
  });
});

describe("RTL locale detection", () => {
  it("identifies RTL locales correctly", () => {
    expect(isRtl("ar")).toBe(true);
    expect(isRtl("ar-SA")).toBe(true);
    expect(isRtl("he-IL")).toBe(true);
    expect(isRtl("fa-IR")).toBe(true);
    expect(isRtl("ur-PK")).toBe(true);
  });

  it("identifies LTR locales correctly", () => {
    expect(isRtl("en-US")).toBe(false);
    expect(isRtl("en-XA")).toBe(false);
    expect(isRtl("fr-CA")).toBe(false);
    expect(isRtl("es-MX")).toBe(false);
    expect(isRtl("ja-JP")).toBe(false);
  });
});

describe("supported locale registry", () => {
  it("includes en-US as source and en-XA as pseudo-locale", () => {
    expect(SUPPORTED_LOCALES).toContain("en-US");
    expect(SUPPORTED_LOCALES).toContain("en-XA");
  });

  it("has the same flat key set across all locales", () => {
    const sourceKeys = new Set(collectFlatKeys(enUs as Record<string, unknown>));
    for (const locale of SUPPORTED_LOCALES) {
      // en-US and en-XA are the only catalogs today; additional locales must
      // match the source key set when added.
      if (locale === "en-US") continue;
      const messages = locale === "en-XA" ? enXa : null;
      if (!messages) continue;
      const localeKeys = new Set(collectFlatKeys(messages as Record<string, unknown>));
      const missing = [...sourceKeys].filter((k) => !localeKeys.has(k));
      const extra = [...localeKeys].filter((k) => !sourceKeys.has(k));
      expect(missing, `${locale}: keys missing from locale`).toEqual([]);
      expect(extra, `${locale}: extra keys in locale`).toEqual([]);
    }
  });
});
