/**
 * Country-aware address input shapes (ADR 0010 spirit: locale adapts
 * presentation, never stored data). One storage model — line1/line2,
 * city, stateProvince, postalCode, country — rendered in the order and
 * labels each country expects, with per-country postal validation that
 * warns but never blocks a save (shops know their streets better than
 * regex does).
 */

export type AddressField = Readonly<{
  name: "line1" | "line2" | "city" | "stateProvince" | "postalCode";
  label: string;
  required: boolean;
  placeholder?: string;
}>;

export type CountryAddressShape = Readonly<{
  country: string;
  countryLabel: string;
  /** Fields in display order; the form lays them out per this list. */
  fields: readonly AddressField[];
  /** Optional postal format check — advisory, surfaced as a hint. */
  postalPattern?: { pattern: RegExp; hint: string };
}>;

const SHAPES: Readonly<Record<string, CountryAddressShape>> = {
  US: {
    country: "US",
    countryLabel: "United States",
    fields: [
      { name: "line1", label: "Street address", required: true, placeholder: "123 Main St" },
      { name: "line2", label: "Apt / suite", required: false },
      { name: "city", label: "City", required: true },
      { name: "stateProvince", label: "State", required: true, placeholder: "NC" },
      { name: "postalCode", label: "ZIP code", required: true, placeholder: "27601" },
    ],
    postalPattern: { pattern: /^\d{5}(-\d{4})?$/, hint: "12345 or 12345-6789" },
  },
  CA: {
    country: "CA",
    countryLabel: "Canada",
    fields: [
      { name: "line1", label: "Street address", required: true, placeholder: "123 Main St" },
      { name: "line2", label: "Unit", required: false },
      { name: "city", label: "City", required: true },
      { name: "stateProvince", label: "Province", required: true, placeholder: "ON" },
      { name: "postalCode", label: "Postal code", required: true, placeholder: "M5V 2T6" },
    ],
    postalPattern: { pattern: /^[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d$/, hint: "A1A 1A1" },
  },
  GB: {
    country: "GB",
    countryLabel: "United Kingdom",
    fields: [
      // UK convention: house number+street, then town, then postcode —
      // county optional and rarely needed for delivery.
      {
        name: "line1",
        label: "House number & street",
        required: true,
        placeholder: "10 Downing St",
      },
      { name: "line2", label: "Second line (area)", required: false, placeholder: "Westminster" },
      { name: "city", label: "Town / city", required: true },
      { name: "stateProvince", label: "County (optional)", required: false },
      { name: "postalCode", label: "Postcode", required: true, placeholder: "SW1A 2AA" },
    ],
    postalPattern: { pattern: /^[A-Za-z]{1,2}\d[A-Za-z\d]? ?\d[A-Za-z]{2}$/, hint: "SW1A 2AA" },
  },
  DE: {
    country: "DE",
    countryLabel: "Germany",
    fields: [
      {
        name: "line1",
        label: "Straße und Hausnummer",
        required: true,
        placeholder: "Hauptstraße 1",
      },
      { name: "line2", label: "Adresszusatz", required: false },
      { name: "postalCode", label: "PLZ", required: true, placeholder: "10115" },
      { name: "city", label: "Stadt", required: true },
      { name: "stateProvince", label: "Bundesland (optional)", required: false },
    ],
    postalPattern: { pattern: /^\d{5}$/, hint: "10115" },
  },
  FR: {
    country: "FR",
    countryLabel: "France",
    fields: [
      { name: "line1", label: "Numéro et rue", required: true, placeholder: "1 rue de la Paix" },
      { name: "line2", label: "Complément", required: false },
      { name: "postalCode", label: "Code postal", required: true, placeholder: "75002" },
      { name: "city", label: "Ville", required: true },
    ],
    postalPattern: { pattern: /^\d{5}$/, hint: "75002" },
  },
  IT: {
    country: "IT",
    countryLabel: "Italy",
    fields: [
      { name: "line1", label: "Via e numero", required: true, placeholder: "Via Roma 1" },
      { name: "line2", label: "Altro", required: false },
      { name: "postalCode", label: "CAP", required: true, placeholder: "20121" },
      { name: "city", label: "Città", required: true },
      { name: "stateProvince", label: "Provincia (optional)", required: false, placeholder: "MI" },
    ],
    postalPattern: { pattern: /^\d{5}$/, hint: "20121" },
  },
  JP: {
    country: "JP",
    countryLabel: "Japan",
    fields: [
      // Japanese forms run largest-to-smallest: postal code, prefecture,
      // city/ward, then block/building numbers. Romaji-friendly labels.
      { name: "postalCode", label: "Postal code (〒)", required: true, placeholder: "100-0001" },
      { name: "stateProvince", label: "Prefecture", required: true, placeholder: "Tokyo" },
      { name: "city", label: "City / ward", required: true, placeholder: "Chiyoda-ku" },
      { name: "line1", label: "Block & building", required: true, placeholder: "1-2-3 Marunouchi" },
      { name: "line2", label: "Apartment / room", required: false },
    ],
    postalPattern: { pattern: /^\d{3}-?\d{4}$/, hint: "100-0001" },
  },
  BR: {
    country: "BR",
    countryLabel: "Brazil",
    fields: [
      { name: "postalCode", label: "CEP", required: true, placeholder: "01310-100" },
      { name: "line1", label: "Rua e número", required: true, placeholder: "Av. Paulista, 1000" },
      { name: "line2", label: "Complemento", required: false },
      { name: "city", label: "Cidade", required: true },
      { name: "stateProvince", label: "UF", required: true, placeholder: "SP" },
    ],
    postalPattern: { pattern: /^\d{5}-?\d{3}$/, hint: "01310-100" },
  },
  AU: {
    country: "AU",
    countryLabel: "Australia",
    fields: [
      { name: "line1", label: "Street address", required: true, placeholder: "1 Collins St" },
      { name: "line2", label: "Unit / level", required: false },
      { name: "city", label: "Suburb", required: true },
      { name: "stateProvince", label: "State", required: true, placeholder: "VIC" },
      { name: "postalCode", label: "Postcode", required: true, placeholder: "3000" },
    ],
    postalPattern: { pattern: /^\d{4}$/, hint: "3000" },
  },
  MX: {
    country: "MX",
    countryLabel: "Mexico",
    fields: [
      { name: "line1", label: "Calle y número", required: true, placeholder: "Av. Reforma 100" },
      { name: "line2", label: "Colonia", required: false },
      { name: "postalCode", label: "Código postal", required: true, placeholder: "06600" },
      { name: "city", label: "Ciudad", required: true },
      { name: "stateProvince", label: "Estado", required: true, placeholder: "CDMX" },
    ],
    postalPattern: { pattern: /^\d{5}$/, hint: "06600" },
  },
  IN: {
    country: "IN",
    countryLabel: "India",
    fields: [
      { name: "line1", label: "House / flat & street", required: true, placeholder: "12 MG Road" },
      { name: "line2", label: "Area / landmark", required: false },
      { name: "city", label: "City", required: true },
      { name: "stateProvince", label: "State", required: true, placeholder: "Karnataka" },
      { name: "postalCode", label: "PIN code", required: true, placeholder: "560001" },
    ],
    postalPattern: { pattern: /^\d{6}$/, hint: "560001" },
  },
};

/** The fallback shape (a sensible generic ordering). */
const GENERIC: CountryAddressShape = {
  country: "",
  countryLabel: "",
  fields: [
    { name: "line1", label: "Address line 1", required: true },
    { name: "line2", label: "Address line 2", required: false },
    { name: "city", label: "City", required: true },
    { name: "stateProvince", label: "State / Province", required: false },
    { name: "postalCode", label: "Postal code", required: false },
  ],
};

export const SUPPORTED_ADDRESS_COUNTRIES: readonly Readonly<{ code: string; label: string }>[] =
  Object.values(SHAPES).map((shape) => ({ code: shape.country, label: shape.countryLabel }));

export function addressShapeFor(country: string | null | undefined): CountryAddressShape {
  if (!country) return GENERIC;
  return SHAPES[country.toUpperCase()] ?? GENERIC;
}

/**
 * Advisory postal check: returns the expected-format hint when the value
 * looks wrong for the country. Never used to block a save.
 */
export function postalHint(country: string | null | undefined, postalCode: string): string | null {
  const shape = addressShapeFor(country);
  if (!shape.postalPattern || !postalCode.trim()) return null;
  return shape.postalPattern.pattern.test(postalCode.trim()) ? null : shape.postalPattern.hint;
}

/**
 * Renders a stored address in its country's reading order for display
 * (cards, prints). Unknown countries render in generic order.
 */
export function formatAddressForDisplay(address: {
  line1: string;
  line2?: string | null;
  city: string;
  stateProvince?: string | null;
  postalCode?: string | null;
  country?: string | null;
}): string {
  const shape = addressShapeFor(address.country);
  const parts = shape.fields
    .map((field) => (address[field.name] ?? "").trim())
    .filter((value) => value.length > 0);
  return parts.join(", ");
}
