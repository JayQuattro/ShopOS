import { describe, expect, it } from "vitest";

import { normalizeVin, validateVin, vinCheckDigit } from "@/modules/assets/vin";

describe("vin normalization and validation", () => {
  it("accepts VINs whose check digit matches", () => {
    // Both decode cleanly (ErrorCode 0) against NHTSA vPIC.
    expect(validateVin("1HGCM82633A004352")).toEqual({ valid: true, vin: "1HGCM82633A004352" });
    expect(validateVin("JH4KA7561PC008269")).toEqual({ valid: true, vin: "JH4KA7561PC008269" });
  });

  it("normalizes case and surrounding whitespace before validating", () => {
    expect(validateVin(" 1hgcm82633a004352 ")).toEqual({
      valid: true,
      vin: "1HGCM82633A004352",
    });
    expect(normalizeVin(" abc ")).toBe("ABC");
  });

  it("rejects VINs that are not exactly 17 characters", () => {
    const result = validateVin("1HGCM82633A00435");
    expect(result).toEqual({ valid: false, vin: "1HGCM82633A00435", reason: "length" });
  });

  it("rejects VINs containing I, O, or Q", () => {
    const result = validateVin("1HGCM82633A00435I");
    expect(result).toEqual({ valid: false, vin: "1HGCM82633A00435I", reason: "characters" });
  });

  it("rejects VINs with a wrong position-9 check digit", () => {
    // The real VIN ends ...004352 (check digit 3); flipping to 4 breaks it.
    const result = validateVin("1HGCM82634A004352");
    expect(result).toEqual({ valid: false, vin: "1HGCM82634A004352", reason: "check_digit" });
  });

  it("returns null for illegal characters such as I", () => {
    expect(vinCheckDigit("1HGCM82633A004352")).toBe("3");
    expect(vinCheckDigit("1HGCM82633AI04352")).toBeNull();
  });
});
