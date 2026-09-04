/**
 * Vehicle identification connector boundary (ADR 0008): VIN decoding behind
 * replaceable provider adapters. Capability `vehicle_identification` on the
 * connector framework. NHTSA vPIC is keyless and public, so it also serves as
 * the built-in default when no connector instance is configured — decoding is
 * an additive enrichment, never required for reading or saving shop data.
 */

export type VinDecodeResult = Readonly<{
  year: number;
  make: string;
  model: string;
  trim?: string;
  engine?: string;
  transmission?: string;
  drivetrain?: string;
  bodyStyle?: string;
  fuelType?: string;
}>;

export interface VehicleIdentificationAdapter {
  readonly key: string;
  decodeVin(vin: string): Promise<VinDecodeResult | null>;
}

/** Small acronyms vPIC returns in caps that should stay in caps when prettified. */
const UPPERCASE_WORDS = new Set(["BMW", "EV", "NEV", "GTI", "AMG"]);

/** "HONDA" → "Honda", "MERCEDES-BENZ" → "Mercedes-Benz", "BMW" → "BMW". */
export function prettifyName(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .map((word) =>
      word
        .split("-")
        .map((part) =>
          UPPERCASE_WORDS.has(part)
            ? part
            : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase(),
        )
        .join("-"),
    )
    .join(" ");
}

/** Dev/test adapter: deterministic capture, never throws, no network. */
export class ConsoleVehicleIdentificationAdapter implements VehicleIdentificationAdapter {
  readonly key = "console";
  readonly decodedVins: string[] = [];

  async decodeVin(vin: string): Promise<VinDecodeResult | null> {
    this.decodedVins.push(vin);
    let hash = 0;
    for (const char of vin) {
      hash = (hash * 31 + char.charCodeAt(0)) % 1_000_003;
    }
    const fixtures: VinDecodeResult[] = [
      {
        year: 2019,
        make: "Honda",
        model: "Civic",
        trim: "EX",
        engine: "1.5L 4-cyl Gasoline",
        transmission: "CVT",
        drivetrain: "FWD",
        bodyStyle: "Sedan",
        fuelType: "Gasoline",
      },
      {
        year: 2021,
        make: "Toyota",
        model: "Tacoma",
        trim: "SR5",
        engine: "3.5L 6-cyl Gasoline",
        transmission: "Automatic 6-spd",
        drivetrain: "4WD",
        bodyStyle: "Pickup",
        fuelType: "Gasoline",
      },
      {
        year: 2020,
        make: "Ford",
        model: "F-150",
        trim: "XLT",
        engine: "3.5L 6-cyl Gasoline",
        transmission: "Automatic 10-spd",
        drivetrain: "4WD",
        bodyStyle: "Pickup",
        fuelType: "Gasoline",
      },
    ];
    return fixtures[hash % fixtures.length]!;
  }
}

let consoleSingleton: ConsoleVehicleIdentificationAdapter | undefined;

export function getConsoleVehicleIdentificationAdapter(): ConsoleVehicleIdentificationAdapter {
  if (!consoleSingleton) consoleSingleton = new ConsoleVehicleIdentificationAdapter();
  return consoleSingleton;
}

// ─── NHTSA vPIC (free, public, no credentials) ───────────────────────────────

type VpicDecodedRow = Partial<Record<string, string>>;

export class NhtsaVpicAdapter implements VehicleIdentificationAdapter {
  readonly key = "nhtsa-vpic";

  async decodeVin(vin: string): Promise<VinDecodeResult | null> {
    const url = `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${encodeURIComponent(vin)}?format=json`;
    let res: Response;
    try {
      res = await fetch(url);
    } catch {
      return null;
    }
    if (!res.ok) return null;
    let body: { Results?: VpicDecodedRow[] };
    try {
      body = (await res.json()) as { Results?: VpicDecodedRow[] };
    } catch {
      return null;
    }

    const row = body.Results?.[0];
    if (!row) return null;

    const make = prettifyName(row.Make ?? "");
    const year = Number.parseInt(row.ModelYear ?? "", 10);
    // vPIC answers with rows full of empty strings for unrecognized VINs.
    if (!make || !Number.isFinite(year) || year < 1900) return null;

    const displacement = Number.parseFloat(row.DisplacementL ?? "");
    const cylinders = Number.parseInt(row.EngineCylinders ?? "", 10);
    const fuel = (row.FuelTypePrimary ?? "").trim();
    const engine = [
      Number.isFinite(displacement) && displacement > 0 ? `${displacement.toFixed(1)}L` : "",
      Number.isFinite(cylinders) && cylinders > 0 ? `${cylinders}-cyl` : "",
      fuel,
    ]
      .filter(Boolean)
      .join(" ");

    const transmissionStyle = (row.TransmissionStyle ?? "").trim();
    const transmissionSpeeds = Number.parseInt(row.TransmissionSpeeds ?? "", 10);
    const transmission = [
      transmissionStyle,
      Number.isFinite(transmissionSpeeds) && transmissionSpeeds > 0
        ? `${transmissionSpeeds}-spd`
        : "",
    ]
      .filter(Boolean)
      .join(" ");

    return {
      year,
      make,
      model: prettifyName(row.Model ?? ""),
      ...(row.Trim?.trim() ? { trim: row.Trim.trim() } : {}),
      ...(engine ? { engine } : {}),
      ...(transmission ? { transmission } : {}),
      ...(row.DriveType?.trim() ? { drivetrain: row.DriveType.trim() } : {}),
      ...(row.BodyClass?.trim() ? { bodyStyle: row.BodyClass.trim() } : {}),
      ...(fuel ? { fuelType: fuel } : {}),
    };
  }
}
