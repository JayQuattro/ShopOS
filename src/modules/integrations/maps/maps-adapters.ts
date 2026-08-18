/**
 * Maps connector boundary (ADR 0008): geocoding and driving-route summaries
 * behind replaceable provider adapters. Capability `maps` on the connector
 * framework — platform-scoped in v1, org→platform resolution per ADR 0008.
 */
export type Coordinates = Readonly<{ lat: number; lng: number }>;

export type GeocodeResult = Readonly<{
  lat: number;
  lng: number;
  formatted: string;
}>;

export type RouteSummary = Readonly<{
  distanceMeters: number;
  durationSeconds: number;
}>;

export interface MapsAdapter {
  readonly key: string;
  geocode(query: string): Promise<GeocodeResult | null>;
  route(origin: Coordinates, destination: Coordinates): Promise<RouteSummary | null>;
}

/** Dev/test adapter: deterministic capture, never throws. */
export class ConsoleMapsAdapter implements MapsAdapter {
  readonly key = "console";
  readonly geocodes: string[] = [];
  readonly routes: string[] = [];

  async geocode(query: string): Promise<GeocodeResult | null> {
    this.geocodes.push(query);
    // Deterministic stand-in: a parseable coordinate in Microsoft's backyard.
    return { lat: 47.639_62, lng: -122.128_331, formatted: query };
  }

  async route(origin: Coordinates, destination: Coordinates): Promise<RouteSummary | null> {
    this.routes.push(`${origin.lat},${origin.lng}->${destination.lat},${destination.lng}`);
    return { distanceMeters: 12_500, durationSeconds: 1_020 };
  }
}

let consoleSingleton: ConsoleMapsAdapter | undefined;

export function getConsoleMapsAdapter(): ConsoleMapsAdapter {
  if (!consoleSingleton) consoleSingleton = new ConsoleMapsAdapter();
  return consoleSingleton;
}

// ─── Google Maps Platform ────────────────────────────────────────────────────

export class GoogleMapsAdapter implements MapsAdapter {
  readonly key = "google";

  constructor(private readonly secret: Readonly<{ apiKey: string }>) {}

  async geocode(query: string): Promise<GeocodeResult | null> {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${this.secret.apiKey}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const body = (await res.json()) as {
      status: string;
      results?: Array<{
        formatted_address?: string;
        geometry?: { location?: { lat: number; lng: number } };
      }>;
    };
    const first = body.results?.[0];
    if (!first?.geometry?.location) return null;
    return {
      lat: first.geometry.location.lat,
      lng: first.geometry.location.lng,
      formatted: first.formatted_address ?? query,
    };
  }

  async route(origin: Coordinates, destination: Coordinates): Promise<RouteSummary | null> {
    const url =
      `https://maps.googleapis.com/maps/api/directions/json?origin=${origin.lat},${origin.lng}` +
      `&destination=${destination.lat},${destination.lng}&mode=driving&key=${this.secret.apiKey}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const body = (await res.json()) as {
      routes?: Array<{
        legs?: Array<{ distance?: { value: number }; duration?: { value: number } }>;
      }>;
    };
    const leg = body.routes?.[0]?.legs?.[0];
    if (!leg?.distance?.value || !leg?.duration?.value) return null;
    return { distanceMeters: leg.distance.value, durationSeconds: leg.duration.value };
  }
}

// ─── Azure Maps ─────────────────────────────────────────────────────────────

export class AzureMapsAdapter implements MapsAdapter {
  readonly key = "azure";

  constructor(private readonly secret: Readonly<{ subscriptionKey: string }>) {}

  async geocode(query: string): Promise<GeocodeResult | null> {
    const url =
      `https://atlas.microsoft.com/search/address/json?api-version=1.0` +
      `&query=${encodeURIComponent(query)}&subscription-key=${this.secret.subscriptionKey}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const body = (await res.json()) as {
      results?: Array<{
        position?: { lat: number; lon: number };
        address?: { freeformAddress?: string };
      }>;
    };
    const first = body.results?.[0];
    if (!first?.position) return null;
    return {
      lat: first.position.lat,
      lng: first.position.lon,
      formatted: first.address?.freeformAddress ?? query,
    };
  }

  async route(origin: Coordinates, destination: Coordinates): Promise<RouteSummary | null> {
    const url =
      `https://atlas.microsoft.com/route/directions?api-version=1.0` +
      `&query=${origin.lat},${origin.lng};${destination.lat},${destination.lng}` +
      `&subscription-key=${this.secret.subscriptionKey}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const body = (await res.json()) as {
      routes?: Array<{ summary?: { lengthInMeters: number; travelTimeInSeconds: number } }>;
    };
    const summary = body.routes?.[0]?.summary;
    if (!summary) return null;
    return {
      distanceMeters: summary.lengthInMeters,
      durationSeconds: summary.travelTimeInSeconds,
    };
  }
}

// ─── Mapbox ─────────────────────────────────────────────────────────────────

export class MapboxAdapter implements MapsAdapter {
  readonly key = "mapbox";

  constructor(private readonly secret: Readonly<{ accessToken: string }>) {}

  async geocode(query: string): Promise<GeocodeResult | null> {
    const url =
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json` +
      `?limit=1&access_token=${this.secret.accessToken}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const body = (await res.json()) as {
      features?: Array<{
        center?: [number, number];
        place_name?: string;
      }>;
    };
    const first = body.features?.[0];
    if (!first?.center) return null;
    return { lat: first.center[1], lng: first.center[0], formatted: first.place_name ?? query };
  }

  async route(origin: Coordinates, destination: Coordinates): Promise<RouteSummary | null> {
    const url =
      `https://api.mapbox.com/directions/v5/mapbox/driving/` +
      `${origin.lng},${origin.lat};${destination.lng},${destination.lat}` +
      `?access_token=${this.secret.accessToken}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const body = (await res.json()) as {
      routes?: Array<{ distance: number; duration: number }>;
    };
    const first = body.routes?.[0];
    if (!first) return null;
    return {
      distanceMeters: Math.round(first.distance),
      durationSeconds: Math.round(first.duration),
    };
  }
}

// ─── AWS Location Service ───────────────────────────────────────────────────

export class AwsLocationAdapter implements MapsAdapter {
  readonly key = "aws";

  constructor(
    private readonly config: Readonly<{
      region: string;
      placeIndexName: string;
      routeCalculatorName: string;
    }>,
    private readonly secret: Readonly<{ accessKeyId: string; secretAccessKey: string }>,
  ) {}

  async geocode(query: string): Promise<GeocodeResult | null> {
    const { SearchPlaceIndexForTextCommand } = await import("@aws-sdk/client-location");
    const client = await this.client();
    const result = await client.send(
      new SearchPlaceIndexForTextCommand({
        IndexName: this.config.placeIndexName,
        Text: query,
        MaxResults: 1,
      }),
    );
    const place = result.Results?.[0]?.Place;
    const center = place?.Geometry?.Point;
    if (!center || center.length < 2) return null;
    return {
      lat: center[1]!,
      lng: center[0]!,
      formatted:
        [place?.AddressNumber, place?.Street, place?.Municipality, place?.Region]
          .filter(Boolean)
          .join(" ") || query,
    };
  }

  async route(origin: Coordinates, destination: Coordinates): Promise<RouteSummary | null> {
    const { CalculateRouteCommand } = await import("@aws-sdk/client-location");
    const client = await this.client();
    const result = await client.send(
      new CalculateRouteCommand({
        CalculatorName: this.config.routeCalculatorName,
        DeparturePosition: [origin.lng, origin.lat],
        DestinationPosition: [destination.lng, destination.lat],
      }),
    );
    const summary = result.Summary;
    if (!summary) return null;
    return {
      distanceMeters: Math.round(summary.Distance ?? 0) || 0,
      durationSeconds: Math.round(summary.DurationSeconds ?? 0) || 0,
    };
  }

  private async client() {
    const { LocationClient } = await import("@aws-sdk/client-location");
    return new LocationClient({
      region: this.config.region,
      credentials: {
        accessKeyId: this.secret.accessKeyId,
        secretAccessKey: this.secret.secretAccessKey,
      },
    });
  }
}
