import { describe, expect, it } from "vitest";

import enUs from "@/messages/en-US.json";
import enXa from "@/messages/en-XA.json";

/**
 * Collects all dot-separated key paths from a nested object.
 */
function collectKeys(obj: Record<string, unknown>, prefix = ""): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      keys.push(...collectKeys(value as Record<string, unknown>, path));
    } else {
      keys.push(path);
    }
  }
  return keys;
}

/**
 * Extracts ICU placeholder names from a message string (e.g. "{name}" → "name").
 */
function extractPlaceholders(message: string): Set<string> {
  const placeholders = new Set<string>();
  const regex = /\{(\w+)(?:,\s*\w+(?:,\s*\w+)?)?\}/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(message)) !== null) {
    placeholders.add(match[1]!);
  }
  return placeholders;
}

describe("ICU message catalog validation", () => {
  const sourceKeys = new Set(collectKeys(enUs as Record<string, unknown>));
  const pseudoKeys = new Set(collectKeys(enXa as Record<string, unknown>));

  it("en-US source catalog has messages", () => {
    expect(sourceKeys.size).toBeGreaterThan(0);
  });

  it("en-XA pseudo-locale has the same key set as en-US", () => {
    const missingFromPseudo = [...sourceKeys].filter((key) => !pseudoKeys.has(key));
    const extraInPseudo = [...pseudoKeys].filter((key) => !sourceKeys.has(key));
    expect(missingFromPseudo, "keys missing from en-XA").toEqual([]);
    expect(extraInPseudo, "extra keys in en-XA").toEqual([]);
  });

  it("every en-US message value is a non-empty string", () => {
    function checkMessages(obj: Record<string, unknown>, path = "") {
      for (const [key, value] of Object.entries(obj)) {
        const currentPath = path ? `${path}.${key}` : key;
        if (typeof value === "object" && value !== null) {
          checkMessages(value as Record<string, unknown>, currentPath);
        } else {
          expect(typeof value, `${currentPath} should be a string`).toBe("string");
          expect((value as string).length, `${currentPath} should not be empty`).toBeGreaterThan(0);
        }
      }
    }
    checkMessages(enUs as Record<string, unknown>);
  });

  it("placeholder names match between en-US and en-XA for every message", () => {
    function checkPlaceholders(
      source: Record<string, unknown>,
      pseudo: Record<string, unknown>,
      path = "",
    ) {
      for (const [key, sourceValue] of Object.entries(source)) {
        const currentPath = path ? `${path}.${key}` : key;
        if (typeof sourceValue === "object" && sourceValue !== null) {
          checkPlaceholders(
            sourceValue as Record<string, unknown>,
            (pseudo[key] as Record<string, unknown>) ?? {},
            currentPath,
          );
        } else if (typeof sourceValue === "string") {
          const pseudoValue = pseudo[key];
          if (typeof pseudoValue === "string") {
            const sourcePlaceholders = extractPlaceholders(sourceValue);
            const pseudoPlaceholders = extractPlaceholders(pseudoValue);
            expect([...sourcePlaceholders].sort(), `${currentPath}: placeholder mismatch`).toEqual(
              [...pseudoPlaceholders].sort(),
            );
          }
        }
      }
    }
    checkPlaceholders(enUs as Record<string, unknown>, enXa as Record<string, unknown>);
  });
});
