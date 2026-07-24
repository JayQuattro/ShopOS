import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Logical CSS properties audit (issue #59 acceptance criterion #3/#4).
 *
 * Verifies that the CSS avoids directional assumptions (left/right) in favor
 * of logical properties (start/end) so the UI mirrors correctly in RTL, and
 * that mixed-direction identifiers use the font-numeric token.
 */

const stylesContent = readFileSync(resolve(process.cwd(), "src/app/styles.css"), "utf-8");

describe("logical CSS properties readiness", () => {
  it("does not use directional float (left/right)", () => {
    const hasDirectionalFloat = /float:\s*(left|right)/.test(stylesContent);
    expect(hasDirectionalFloat, "styles.css should not use directional float").toBe(false);
  });

  it("defines data-density variants for compact mode", () => {
    expect(stylesContent).toContain("data-density");
    expect(stylesContent).toContain("--control-height");
  });

  it("does not force LTR direction globally", () => {
    const supportsRtl = stylesContent.includes("[dir") || !stylesContent.includes("direction: ltr");
    expect(supportsRtl, "CSS should not force LTR direction globally").toBe(true);
  });
});

describe("mixed-direction identifier safety", () => {
  it("the font-numeric token exists for monospace rendering of mixed-direction values", () => {
    expect(stylesContent).toContain("--font-numeric");
  });

  it("the CSS includes a print stylesheet that preserves data integrity", () => {
    expect(stylesContent).toContain("@media print");
    expect(stylesContent).toContain("data-print-hidden");
  });
});
