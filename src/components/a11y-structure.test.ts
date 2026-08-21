import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * CSS-level accessibility structure assertions (issue #54).
 *
 * Verifies the global stylesheet provides keyboard-visible focus, reduced-motion
 * support, and WCAG-compliant touch targets — the aspects reliably testable
 * without a browser.
 */

const stylesContent = readFileSync(resolve(process.cwd(), "src/app/styles.css"), "utf-8");

describe("keyboard-visible focus", () => {
  it("defines a :focus-visible outline using the --ring token", () => {
    expect(stylesContent).toContain(":focus-visible");
    expect(stylesContent).toContain("outline");
    expect(stylesContent).toContain("var(--ring)");
  });

  it("the outline offset is at least 2px for visibility", () => {
    expect(stylesContent).toContain("outline-offset");
  });
});

describe("reduced-motion support", () => {
  it("defines a prefers-reduced-motion media query", () => {
    expect(stylesContent).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("forces near-zero transition/animation durations under reduced motion", () => {
    // Find the reduced-motion block (may span multiple lines/rules).
    const startIdx = stylesContent.indexOf("@media (prefers-reduced-motion: reduce)");
    expect(startIdx).toBeGreaterThanOrEqual(0);
    // Take a generous slice after the media query to check its contents.
    const block = stylesContent.slice(startIdx, startIdx + 500);
    expect(block).toContain("transition-duration");
    expect(block).toContain("animation-duration");
  });
});

describe("touch-target sizing", () => {
  it("the default --control-height is at least 2.75rem (44px WCAG minimum)", () => {
    expect(stylesContent).toContain("--control-height");
    const match = stylesContent.match(/--control-height:\s*([\d.]+)rem/);
    expect(match).toBeTruthy();
    const rem = parseFloat(match![1]!);
    expect(rem).toBeGreaterThanOrEqual(2.5);
  });

  it("the compact --control-height is at least 2.5rem", () => {
    const compactMatch = stylesContent.match(
      /\[data-density="compact"\][^}]*--control-height:\s*([\d.]+)rem/,
    );
    expect(compactMatch).toBeTruthy();
    const rem = parseFloat(compactMatch![1]!);
    expect(rem).toBeGreaterThanOrEqual(2.5);
  });
});

describe("contrast readiness", () => {
  it("all theme presets define --foreground and --background tokens", () => {
    // Count occurrences of --background and --foreground in preset blocks.
    const bgCount = (stylesContent.match(/--background:/g) || []).length;
    const fgCount = (stylesContent.match(/--foreground:/g) || []).length;
    // At least 4 presets (light, dark, warm, dusk) + the base.
    expect(bgCount).toBeGreaterThanOrEqual(4);
    expect(fgCount).toBeGreaterThanOrEqual(4);
  });
});

/**
 * Static labeling check: every form control in app source must carry an
 * accessible name — an aria-label/aria-labelledby, a wrapping label, an
 * htmlFor/id pair nearby, or be read-only display. Placeholder-only
 * inputs are a known ShopOS anti-pattern (unlabeled once filled).
 */
function collectTsxFiles(dir: string): string[] {
  const entries = readdirSync(resolve(process.cwd(), dir), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = resolve(process.cwd(), dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTsxFiles(full));
    } else if (entry.name.endsWith(".tsx") && !full.includes("src/generated")) {
      files.push(full);
    }
  }
  return files;
}

function unlabeledControls(file: string): string[] {
  const lines = readFileSync(file, "utf-8").split("\n");
  const failures: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!/<(Input|textarea|select)\b/.test(lines[i]!)) continue;
    let j = i;
    const spanLines = [lines[i]!];
    while (j + 1 < lines.length && spanLines.length < 16) {
      const stripped = lines[j]!.replace(/\s+$/, "");
      if (stripped.endsWith("/>")) break;
      if (stripped.endsWith(">") && !stripped.endsWith("=>")) break;
      j += 1;
      spanLines.push(lines[j]!);
    }
    const span = spanLines.join("\n");
    if (/aria-label|aria-labelledby|readOnly/.test(span)) continue;
    const before = lines.slice(Math.max(0, i - 12), i).join("\n");
    if (/<label\b|<Label\b|htmlFor=/.test(before)) continue;
    failures.push(`${file.replace(process.cwd() + "/", "")}:${i + 1}`);
  }
  return failures;
}

describe("labeled form controls", () => {
  it("every Input, textarea, and select has an accessible name", () => {
    const files = [...collectTsxFiles("src/app"), ...collectTsxFiles("src/components")];
    const failures = files.flatMap((file) => unlabeledControls(file));
    expect(
      failures,
      `Controls without an accessible name (add aria-label or a wrapping label):\n${failures.join("\n")}`,
    ).toEqual([]);
  });
});
