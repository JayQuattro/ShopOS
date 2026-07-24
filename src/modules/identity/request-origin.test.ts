import { describe, expect, it } from "vitest";

import { hasTrustedMutationOrigin } from "./request-origin";

describe("hasTrustedMutationOrigin", () => {
  it("accepts the configured ShopOS origin", () => {
    const request = new Request("http://localhost:3000/api/onboarding/organization", {
      method: "POST",
      headers: { origin: "http://localhost:3000" },
    });
    expect(hasTrustedMutationOrigin(request)).toBe(true);
  });

  it("denies missing, malformed, and cross-site origins", () => {
    expect(
      hasTrustedMutationOrigin(
        new Request("http://localhost:3000/api/onboarding/organization", { method: "POST" }),
      ),
    ).toBe(false);
    expect(
      hasTrustedMutationOrigin(
        new Request("http://localhost:3000/api/onboarding/organization", {
          method: "POST",
          headers: { origin: "not a url" },
        }),
      ),
    ).toBe(false);
    expect(
      hasTrustedMutationOrigin(
        new Request("http://localhost:3000/api/onboarding/organization", {
          method: "POST",
          headers: { origin: "https://attacker.example" },
        }),
      ),
    ).toBe(false);
  });
});
