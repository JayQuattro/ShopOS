import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ConsoleVehicleIdentificationAdapter,
  NhtsaVpicAdapter,
  prettifyName,
} from "@/modules/integrations/vehicle-id/vehicle-id-adapters";
import {
  VEHICLE_ID_ADAPTER_DEFINITIONS,
  getVehicleIdAdapterDefinition,
  instantiateVehicleIdAdapter,
} from "@/modules/integrations/vehicle-id/vehicle-id-connector-service";

/** Minimal Response-like object: only what the adapters read. */
function jsonResponse(body: unknown, ok = true): Response {
  return { ok, json: () => Promise.resolve(body) } as unknown as Response;
}

const fetchCalls: string[] = [];
let fetchResult: Response = jsonResponse({});

beforeEach(() => {
  fetchCalls.length = 0;
  fetchResult = jsonResponse({});
  vi.stubGlobal("fetch", async (url: string | URL) => {
    fetchCalls.push(String(url));
    return fetchResult;
  });
});

/** Recorded (trimmed) NHTSA vPIC DecodeVinValues response for 1HGCM82633A004352. */
const VPIC_SAMPLE = {
  Count: 132,
  Message: "Results returned successfully",
  Results: [
    {
      VIN: "1HGCM82633A004352",
      ErrorCode: "0",
      Make: "HONDA",
      Model: "Accord",
      ModelYear: "2003",
      Trim: "EX-V6",
      BodyClass: "Coupe",
      EngineCylinders: "6",
      DisplacementL: "2.998832712",
      FuelTypePrimary: "Gasoline",
      TransmissionStyle: "Automatic",
      TransmissionSpeeds: "5",
      DriveType: "",
    },
  ],
};

describe("console vehicle identification adapter", () => {
  it("returns a deterministic decode without any network call", async () => {
    const adapter = new ConsoleVehicleIdentificationAdapter();

    const first = await adapter.decodeVin("1HGCM82633A004352");
    const second = await adapter.decodeVin("1HGCM82633A004352");

    expect(fetchCalls).toHaveLength(0);
    expect(second).toEqual(first);
    expect(first?.year).toBeGreaterThanOrEqual(2019);
    expect(first?.make).toBeTruthy();
    expect(adapter.decodedVins).toEqual(["1HGCM82633A004352", "1HGCM82633A004352"]);
  });
});

describe("nhtsa vpic adapter", () => {
  const adapter = new NhtsaVpicAdapter();

  it("decodes through DecodeVinValues and composes engine/transmission summaries", async () => {
    fetchResult = jsonResponse(VPIC_SAMPLE);

    const result = await adapter.decodeVin("1HGCM82633A004352");

    expect(fetchCalls).toHaveLength(1);
    const url = new URL(fetchCalls[0]!);
    expect(url.origin + url.pathname).toBe(
      "https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/1HGCM82633A004352",
    );
    expect(url.searchParams.get("format")).toBe("json");
    expect(result).toEqual({
      year: 2003,
      make: "Honda",
      model: "Accord",
      trim: "EX-V6",
      engine: "3.0L 6-cyl Gasoline",
      transmission: "Automatic 5-spd",
      bodyStyle: "Coupe",
      fuelType: "Gasoline",
    });
  });

  it("omits absent details instead of emitting empty strings", async () => {
    fetchResult = jsonResponse({
      Results: [
        {
          ...VPIC_SAMPLE.Results[0]!,
          EngineCylinders: "",
          DisplacementL: "",
          TransmissionStyle: "",
          TransmissionSpeeds: "",
          DriveType: "",
        },
      ],
    });

    const result = await adapter.decodeVin("1HGCM82633A004352");

    expect(result?.engine).toBe("Gasoline");
    expect("transmission" in (result ?? {})).toBe(false);
    expect("drivetrain" in (result ?? {})).toBe(false);
  });

  it("returns null when vPIC cannot identify the vehicle", async () => {
    fetchResult = jsonResponse({
      Results: [{ ErrorCode: "11", Make: "", Model: "", ModelYear: "" }],
    });
    expect(await adapter.decodeVin("1HGCM82634A004352")).toBeNull();
  });

  it("returns null on a non-ok response, an empty result set, or a network failure", async () => {
    fetchResult = jsonResponse({}, false);
    expect(await adapter.decodeVin("1HGCM82633A004352")).toBeNull();

    fetchResult = jsonResponse({ Results: [] });
    expect(await adapter.decodeVin("1HGCM82633A004352")).toBeNull();

    vi.stubGlobal("fetch", async () => {
      throw new Error("network unreachable");
    });
    expect(await adapter.decodeVin("1HGCM82633A004352")).toBeNull();
  });
});

describe("prettifyName", () => {
  it("title-cases manufacturer names while keeping known acronyms", () => {
    expect(prettifyName("HONDA")).toBe("Honda");
    expect(prettifyName("MERCEDES-BENZ")).toBe("Mercedes-Benz");
    expect(prettifyName("BMW")).toBe("BMW");
    expect(prettifyName("AMERICAN HONDA MOTOR CO., INC.")).toBe("American Honda Motor Co., Inc.");
  });
});

describe("vehicle id adapter definitions", () => {
  it("registers the keyless public decoder and an explicit off switch", () => {
    expect(VEHICLE_ID_ADAPTER_DEFINITIONS.map((d) => d.key)).toEqual(["nhtsa-vpic", "disabled"]);
    expect(getVehicleIdAdapterDefinition("nhtsa-vpic")?.configFields).toEqual([]);
    expect(getVehicleIdAdapterDefinition("nhtsa-vpic")?.secretFields).toEqual([]);
    expect(getVehicleIdAdapterDefinition("nope")).toBeUndefined();
  });

  it("instantiates the decoder and refuses unknown or disabled keys", () => {
    expect(instantiateVehicleIdAdapter("nhtsa-vpic", {}, {}) instanceof NhtsaVpicAdapter).toBe(
      true,
    );
    expect(instantiateVehicleIdAdapter("disabled", {}, {})).toBeNull();
    expect(instantiateVehicleIdAdapter("carfax", {}, {})).toBeNull();
  });
});
