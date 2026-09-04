/**
 * VIN normalization and structural validation (FMVSS 115): 17 characters,
 * no I/O/Q, and a position-9 check digit. Validation is instant client-side
 * feedback before any decoder call — it never gates what a user may save.
 */

const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/;

const TRANSLITERATION: Readonly<Record<string, number>> = {
  A: 1,
  B: 2,
  C: 3,
  D: 4,
  E: 5,
  F: 6,
  G: 7,
  H: 8,
  J: 1,
  K: 2,
  L: 3,
  M: 4,
  N: 5,
  P: 7,
  R: 9,
  S: 2,
  T: 3,
  U: 4,
  V: 5,
  W: 6,
  X: 7,
  Y: 8,
  Z: 9,
};

/** Weights for positions 1–8 and 10–17; position 9 is the check digit. */
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2] as const;

export type VinInvalidReason = "length" | "characters" | "check_digit";

export type VinValidation =
  | Readonly<{ valid: true; vin: string }>
  | Readonly<{ valid: false; vin: string; reason: VinInvalidReason }>;

export function normalizeVin(input: string): string {
  return input.trim().toUpperCase();
}

/** Computes the expected check-digit character ("X" represents 10). */
export function vinCheckDigit(vin: string): string | null {
  let sum = 0;
  for (let i = 0; i < 17; i += 1) {
    const char = vin[i]!;
    const value = char >= "0" && char <= "9" ? Number(char) : TRANSLITERATION[char];
    if (value === undefined) return null;
    sum += value * WEIGHTS[i]!;
  }
  const remainder = sum % 11;
  return remainder === 10 ? "X" : String(remainder);
}

export function validateVin(input: string): VinValidation {
  const vin = normalizeVin(input);
  if (vin.length !== 17) return { valid: false, vin, reason: "length" };
  if (!VIN_PATTERN.test(vin)) return { valid: false, vin, reason: "characters" };
  const expected = vinCheckDigit(vin);
  if (!expected || vin[8] !== expected) {
    return { valid: false, vin, reason: "check_digit" };
  }
  return { valid: true, vin };
}
