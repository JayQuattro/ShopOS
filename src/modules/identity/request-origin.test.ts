import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { resetAuthConfigCache } from "@/modules/identity/config";
import { hasTrustedMutationOrigin } from "./request-origin";

// hasTrustedMutationOrigin reads the validated auth config at call time, which
// requires BETTER_AUTH_SECRET/BETTER_AUTH_URL. Stub them before the module graph
// loads so the test is deterministic without a local .env file.
beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "postgres://shopos:shopos@127.0.0.1:5432/shopos");
  vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
  vi.stubEnv("BETTER_AUTH_SECRET", "test-only-better-auth-secret-at-least-32-characters");
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("AUTH_EMAIL_DELIVERY", "console");
  resetAuthConfigCache();
});

afterAll(() => {
  vi.unstubAllEnvs();
  resetAuthConfigCache();
});

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
