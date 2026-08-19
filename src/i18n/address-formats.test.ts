import { describe, expect, it } from "vitest";

import { addressShapeFor, postalHint } from "./address-formats";

describe("addressShapeFor", () => {
  it("orders fields per country convention", () => {
    // US: street → city → state → ZIP.
    const us = addressShapeFor("US").fields.map((f) => f.name);
    expect(us).toEqual(["line1", "line2", "city", "stateProvince", "postalCode"]);

    // Germany: street → PLZ → city (postcode before city).
    const de = addressShapeFor("DE").fields.map((f) => f.name);
    expect(de.indexOf("postalCode")).toBeLessThan(de.indexOf("city"));

    // Japan: postal code first, block/building last.
    const jp = addressShapeFor("JP").fields.map((f) => f.name);
    expect(jp[0]).toBe("postalCode");
    expect(jp[jp.length - 1]).toBe("line2");

    // Brazil: CEP first.
    expect(addressShapeFor("BR").fields[0]?.name).toBe("postalCode");
  });

  it("labels fields in the country's own terms", () => {
    expect(addressShapeFor("GB").fields[0]?.label).toBe("House number & street");
    expect(addressShapeFor("DE").fields.find((f) => f.name === "postalCode")?.label).toBe("PLZ");
    expect(addressShapeFor("BR").fields.find((f) => f.name === "stateProvince")?.label).toBe("UF");
    expect(addressShapeFor("US").fields.find((f) => f.name === "postalCode")?.label).toBe(
      "ZIP code",
    );
  });

  it("requires what each country actually requires", () => {
    // UK county is famously optional; state is required in the US.
    expect(addressShapeFor("GB").fields.find((f) => f.name === "stateProvince")?.required).toBe(
      false,
    );
    expect(addressShapeFor("US").fields.find((f) => f.name === "stateProvince")?.required).toBe(
      true,
    );
    // Prefecture required in Japan; province-free France omits it entirely.
    expect(addressShapeFor("JP").fields.find((f) => f.name === "stateProvince")?.required).toBe(
      true,
    );
    expect(addressShapeFor("FR").fields.find((f) => f.name === "stateProvince")).toBeUndefined();
  });

  it("falls back to a generic shape for unknown or missing countries", () => {
    expect(addressShapeFor("ZZ").fields[0]?.name).toBe("line1");
    expect(addressShapeFor(null).fields.map((f) => f.name)).toEqual([
      "line1",
      "line2",
      "city",
      "stateProvince",
      "postalCode",
    ]);
    // Case-insensitive lookup.
    expect(addressShapeFor("de").fields[0]?.label).toBe("Straße und Hausnummer");
  });
});

describe("postalHint", () => {
  it("advises on format mismatches without judgement", () => {
    expect(postalHint("US", "2760")).toBe("12345 or 12345-6789");
    expect(postalHint("US", "27601-1234")).toBeNull();
    expect(postalHint("GB", "SW1A 2AA")).toBeNull();
    expect(postalHint("GB", "BADS")).toBe("SW1A 2AA");
    expect(postalHint("JP", "1000001")).toBeNull(); // hyphen optional
    expect(postalHint("BR", "01310100")).toBeNull();
  });

  it("stays silent when there is nothing to say", () => {
    expect(postalHint("US", "")).toBeNull();
    expect(postalHint("ZZ", "anything")).toBeNull(); // no shape, no opinion
    expect(postalHint(null, "123")).toBeNull();
  });
});
