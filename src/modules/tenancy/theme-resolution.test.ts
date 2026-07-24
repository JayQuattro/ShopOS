import { describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { DEFAULT_THEME_STATE, resolveThemeState } from "@/modules/tenancy/theme-resolution";

function makeDb(
  publication: Record<string, unknown> | null,
  membership: Record<string, unknown> | null,
): PrismaClient {
  return {
    organizationThemePublication: {
      findFirst: async () => publication,
    },
    organizationMembership: {
      findFirst: async () => membership,
    },
  } as unknown as PrismaClient;
}

describe("resolveThemeState", () => {
  it("returns safe defaults when no publication or membership preferences exist", async () => {
    const state = await resolveThemeState(makeDb(null, null), {
      organizationId: "org-1",
      membershipId: "mem-1",
    });
    expect(state.resolvedTheme).toBe("light");
    expect(state.themePreference).toBe("system");
    expect(state.density).toBe("comfortable");
  });

  it("uses the org published preset when the user preference is system", async () => {
    const state = await resolveThemeState(
      makeDb(
        {
          preset: "warm",
          densityDefault: "compact",
          radiusScale: "round",
          accentHue: 220,
          logoUrl: null,
        },
        { themePreference: "system", densityPreference: "comfortable" },
      ),
      { organizationId: "org-1", membershipId: "mem-1" },
    );
    expect(state.resolvedTheme).toBe("warm");
    expect(state.density).toBe("comfortable");
    expect(state.radiusScale).toBe("round");
    expect(state.accentHue).toBe(220);
  });

  it("overrides the org preset with the user's explicit choice", async () => {
    const state = await resolveThemeState(
      makeDb(
        {
          preset: "warm",
          densityDefault: "compact",
          radiusScale: "standard",
          accentHue: null,
          logoUrl: null,
        },
        { themePreference: "dark", densityPreference: "compact" },
      ),
      { organizationId: "org-1", membershipId: "mem-1" },
    );
    expect(state.resolvedTheme).toBe("dark");
    expect(state.density).toBe("compact");
  });

  it("falls back to defaults for invalid/garbage stored values", async () => {
    const state = await resolveThemeState(
      makeDb(
        {
          preset: "neon",
          densityDefault: "ultra",
          radiusScale: "wavy",
          accentHue: null,
          logoUrl: null,
        },
        { themePreference: "rainbow", densityPreference: "tiny" },
      ),
      { organizationId: "org-1", membershipId: "mem-1" },
    );
    expect(state.resolvedTheme).toBe("light");
    expect(state.themePreference).toBe("system");
    expect(state.density).toBe("comfortable");
    expect(state.radiusScale).toBe("standard");
  });

  it("DEFAULT_THEME_STATE is a valid light/comfortable baseline", () => {
    expect(DEFAULT_THEME_STATE.resolvedTheme).toBe("light");
    expect(DEFAULT_THEME_STATE.density).toBe("comfortable");
  });
});
