/**
 * Phone normalization to E.164 using libphonenumber (metadata-driven, not
 * regex guessing). Accepts what people actually type — local formats,
 * national prefixes, spaced/dashed international forms — and normalizes
 * against a configurable default country so "+1 (919) 555-0141", "919
 * 555 0141", and "0141" with country IT all resolve deterministically.
 *
 * Returns { e164, country, national } for storage and display, or null
 * when the input cannot be a phone number. Never throws.
 */
import { AsYouType, parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/max";

export type ParsedPhone = Readonly<{
  e164: string;
  country: string | null;
  national: string;
}>;

export function parsePhoneInput(raw: string, defaultCountry?: string | null): ParsedPhone | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const country =
    defaultCountry && /^[A-Z]{2}$/.test(defaultCountry)
      ? (defaultCountry as CountryCode)
      : undefined;

  try {
    const parsed = parsePhoneNumberFromString(trimmed, country);
    if (!parsed || !parsed.isValid()) {
      // Liberal fallback: keep an obviously-numeric blob as national digits
      // when full validation fails, rather than rejecting the customer's data.
      const digits = trimmed.replace(/[^\d]/g, "");
      if (digits.length < 6 || digits.length > 15) return null;
      return { e164: `+${digits}`, country: null, national: digits };
    }
    return {
      e164: parsed.number,
      country: parsed.country ?? null,
      national: parsed.nationalNumber,
    };
  } catch {
    return null;
  }
}

/** Formats as the user types for input masks (no country guess on empty). */
export function formatPhoneAsYouType(raw: string, defaultCountry?: string | null): string {
  if (!raw) return "";
  const country =
    defaultCountry && /^[A-Z]{2}$/.test(defaultCountry)
      ? (defaultCountry as CountryCode)
      : undefined;
  try {
    return new AsYouType(country).input(raw);
  } catch {
    return raw;
  }
}
