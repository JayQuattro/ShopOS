import { describe, expect, it } from "vitest";

import { humanizeToken } from "@/lib/labels";

describe("humanizeToken", () => {
  it("humanizes snake case tokens", () => {
    expect(humanizeToken("READY_FOR_PICKUP")).toBe("Ready for pickup");
    expect(humanizeToken("AWAITING_AUTHORIZATION")).toBe("Awaiting authorization");
  });

  it("title-cases single words", () => {
    expect(humanizeToken("vehicle")).toBe("Vehicle");
    expect(humanizeToken("INDIVIDUAL")).toBe("Individual");
  });

  it("handles separators and stray whitespace", () => {
    expect(humanizeToken("in-progress")).toBe("In progress");
    expect(humanizeToken("  spaced   out ")).toBe("Spaced out");
  });

  it("returns the input unchanged for empty tokens", () => {
    expect(humanizeToken("")).toBe("");
    expect(humanizeToken("___")).toBe("___");
  });
});
