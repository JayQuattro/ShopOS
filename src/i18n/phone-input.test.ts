import { describe, expect, it } from "vitest";

import { parsePhoneInput } from "./phone-input";

describe("parsePhoneInput", () => {
  it("normalizes US formats against a US default country", () => {
    expect(parsePhoneInput("+1 (919) 555-0141", "US")?.e164).toBe("+19195550141");
    expect(parsePhoneInput("919 555-0141", "US")?.e164).toBe("+19195550141");
    expect(parsePhoneInput("(919) 555.0141", "US")).toMatchObject({
      e164: "+19195550141",
      country: "US",
      national: "9195550141",
    });
  });

  it("normalizes national formats against other default countries", () => {
    expect(parsePhoneInput("02 1234 5678", "IT")?.e164).toBe("+390212345678");
    expect(parsePhoneInput("030 1234567", "DE")?.e164).toBe("+49301234567");
    expect(parsePhoneInput("02 9555 0123", "AU")?.country).toBe("AU");
  });

  it("honors an explicit international prefix regardless of default", () => {
    expect(parsePhoneInput("+39 02 1234 5678", "US")?.e164).toBe("+390212345678");
    expect(parsePhoneInput("0039 02 12345678", "DE")?.e164).toBe("+390212345678");
  });

  it("keeps obviously-numeric blobs without inventing validity", () => {
    const loose = parsePhoneInput("123456789", null);
    expect(loose?.e164).toBe("+123456789");
    expect(loose?.country).toBeNull();
  });

  it("rejects junk and empty input", () => {
    expect(parsePhoneInput("", "US")).toBeNull();
    expect(parsePhoneInput("not a phone", "US")).toBeNull();
    expect(parsePhoneInput("12", "US")).toBeNull();
    expect(parsePhoneInput("12345678901234567890", "US")).toBeNull();
  });
});
