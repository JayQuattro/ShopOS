import type { PrismaClient } from "@/generated/prisma/client";

export type ThemePreset = "light" | "dark" | "warm" | "dusk";
export type ThemePreferenceValue = ThemePreset | "system";
export type DensityPreference = "comfortable" | "compact";
export type RadiusScale = "standard" | "sharp" | "round";

export type ResolvedThemeState = Readonly<{
  /** The resolved preset to apply as `data-theme` (never "system"). */
  resolvedTheme: ThemePreset;
  /** The raw user preference (may be "system" which the client resolves via OS). */
  themePreference: ThemePreferenceValue;
  /** The density to apply as `data-density`. */
  density: DensityPreference;
  /** The org's published radius scale (future CSS override hook). */
  radiusScale: RadiusScale;
  /** The org's published accent hue (future contrast-validated override hook). */
  accentHue: number | null;
  /** The org's published logo URL, if any. */
  logoUrl: string | null;
}>;

export const DEFAULT_THEME_STATE: ResolvedThemeState = {
  resolvedTheme: "light",
  themePreference: "system",
  density: "comfortable",
  radiusScale: "standard",
  accentHue: null,
  logoUrl: null,
};

const VALID_PRESETS: ReadonlySet<string> = new Set(["light", "dark", "warm", "dusk"]);
const VALID_PREFERENCES: ReadonlySet<string> = new Set(["system", "light", "dark", "warm", "dusk"]);
const VALID_DENSITY: ReadonlySet<string> = new Set(["comfortable", "compact"]);
const VALID_RADIUS: ReadonlySet<string> = new Set(["standard", "sharp", "round"]);

/**
 * Resolves the theme state for server-rendered HTML attributes, applying the
 * documented precedence model (ADR 0009):
 *
 * 1. Protected constraints (functional colors are never overridden here)
 * 2. ShopOS default preset (Light)
 * 3. Organization's published theme
 * 4. User's permitted preference
 * 5. OS a11y / color-scheme (resolved client-side via the "system" preference)
 *
 * Returns safe defaults when the org has no publication or the membership has
 * no stored preferences (missing/stale data never breaks rendering).
 */
export async function resolveThemeState(
  db: PrismaClient,
  input: Readonly<{ organizationId: string; membershipId: string }>,
): Promise<ResolvedThemeState> {
  const [publication, membership] = await Promise.all([
    db.organizationThemePublication.findFirst({
      where: { organizationId: input.organizationId },
      orderBy: { version: "desc" },
      select: {
        preset: true,
        accentHue: true,
        radiusScale: true,
        densityDefault: true,
        logoUrl: true,
      },
    }),
    db.organizationMembership.findFirst({
      where: {
        id: input.membershipId,
        organizationId: input.organizationId,
      },
      select: { themePreference: true, densityPreference: true },
    }),
  ]);

  // Layer 3: org published theme (or defaults).
  const orgPreset =
    publication && VALID_PRESETS.has(publication.preset)
      ? (publication.preset as ThemePreset)
      : "light";
  const orgDensity =
    publication && VALID_DENSITY.has(publication.densityDefault)
      ? (publication.densityDefault as DensityPreference)
      : "comfortable";
  const radiusScale =
    publication && VALID_RADIUS.has(publication.radiusScale)
      ? (publication.radiusScale as RadiusScale)
      : "standard";

  // Layer 4: user preference overrides (within allowed set — today all presets allowed).
  const rawUserPref = membership?.themePreference ?? "system";
  const userPref: ThemePreferenceValue = VALID_PREFERENCES.has(rawUserPref)
    ? (rawUserPref as ThemePreferenceValue)
    : "system";

  const rawUserDensity = membership?.densityPreference ?? orgDensity;
  const userDensity: DensityPreference = VALID_DENSITY.has(rawUserDensity)
    ? (rawUserDensity as DensityPreference)
    : orgDensity;

  // Resolve: if the user chose a specific preset, use it; if "system", fall back
  // to the org preset (the client bootstrap script resolves "system" via OS).
  const resolvedTheme: ThemePreset = userPref === "system" ? orgPreset : userPref;

  return {
    resolvedTheme,
    themePreference: userPref,
    density: userDensity,
    radiusScale,
    accentHue: publication?.accentHue ?? null,
    logoUrl: publication?.logoUrl ?? null,
  };
}
