import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AwsLocationAdapter,
  AzureMapsAdapter,
  ConsoleMapsAdapter,
  GoogleMapsAdapter,
  MapboxAdapter,
} from "@/modules/integrations/maps/maps-adapters";
import {
  MAPS_ADAPTER_DEFINITIONS,
  getMapsAdapterDefinition,
  instantiateMapsAdapter,
} from "@/modules/integrations/maps/maps-connector-service";

const ORIGIN = { lat: 47.639_62, lng: -122.128_331 };
const DESTINATION = { lat: 47.620_5, lng: -122.349_3 };

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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("console maps adapter", () => {
  it("returns deterministic geocode and route values without network", () => {
    const adapter = new ConsoleMapsAdapter();
    expect(fetchCalls).toHaveLength(0);

    return adapter.geocode("123 Main St").then((geocode) => {
      expect(geocode).toEqual({
        lat: 47.639_62,
        lng: -122.128_331,
        formatted: "123 Main St",
      });
      return adapter.route(ORIGIN, DESTINATION).then((route) => {
        expect(route).toEqual({ distanceMeters: 12_500, durationSeconds: 1_020 });
      });
    });
  });
});

describe("google maps adapter", () => {
  const adapter = new GoogleMapsAdapter({ apiKey: "test-key" });

  it("geocodes through the Geocoding API with the key as a query parameter", async () => {
    fetchResult = jsonResponse({
      status: "OK",
      results: [
        {
          formatted_address: "123 Main St, Redmond, WA 98052, USA",
          geometry: { location: { lat: 47.639_62, lng: -122.128_331 } },
        },
      ],
    });

    const result = await adapter.geocode("123 Main St");

    expect(fetchCalls).toHaveLength(1);
    const url = new URL(fetchCalls[0]!);
    expect(url.origin + url.pathname).toBe("https://maps.googleapis.com/maps/api/geocode/json");
    expect(url.searchParams.get("address")).toBe("123 Main St");
    expect(url.searchParams.get("key")).toBe("test-key");
    expect(result).toEqual({
      lat: 47.639_62,
      lng: -122.128_331,
      formatted: "123 Main St, Redmond, WA 98052, USA",
    });
  });

  it("returns null when google reports no results", async () => {
    fetchResult = jsonResponse({ status: "ZERO_RESULTS", results: [] });
    expect(await adapter.geocode("nowhere")).toBeNull();
  });

  it("summarizes a driving route from the Directions API legs", async () => {
    fetchResult = jsonResponse({
      routes: [
        {
          legs: [
            {
              distance: { value: 12_500 },
              duration: { value: 1_020 },
            },
          ],
        },
      ],
    });

    const route = await adapter.route(ORIGIN, DESTINATION);

    const url = new URL(fetchCalls[0]!);
    expect(url.pathname).toBe("/maps/api/directions/json");
    expect(url.searchParams.get("origin")).toBe("47.63962,-122.128331");
    expect(url.searchParams.get("destination")).toBe("47.6205,-122.3493");
    expect(url.searchParams.get("mode")).toBe("driving");
    expect(route).toEqual({ distanceMeters: 12_500, durationSeconds: 1_020 });
  });

  it("returns null on a non-ok response", async () => {
    fetchResult = jsonResponse({}, false);
    expect(await adapter.geocode("123 Main St")).toBeNull();
    expect(await adapter.route(ORIGIN, DESTINATION)).toBeNull();
  });
});

describe("azure maps adapter", () => {
  const adapter = new AzureMapsAdapter({ subscriptionKey: "test-sub-key" });

  it("geocodes through Fuzzy Search with the subscription key", async () => {
    fetchResult = jsonResponse({
      results: [
        {
          position: { lat: 47.639_62, lon: -122.128_331 },
          address: { freeformAddress: "123 Main St, Redmond, WA 98052" },
        },
      ],
    });

    const result = await adapter.geocode("123 Main St");

    const url = new URL(fetchCalls[0]!);
    expect(url.origin + url.pathname).toBe("https://atlas.microsoft.com/search/address/json");
    expect(url.searchParams.get("api-version")).toBe("1.0");
    expect(url.searchParams.get("query")).toBe("123 Main St");
    expect(url.searchParams.get("subscription-key")).toBe("test-sub-key");
    expect(result).toEqual({
      lat: 47.639_62,
      lng: -122.128_331,
      formatted: "123 Main St, Redmond, WA 98052",
    });
  });

  it("returns null when azure reports no results", async () => {
    fetchResult = jsonResponse({ results: [] });
    expect(await adapter.geocode("nowhere")).toBeNull();
  });

  it("summarizes a route from the route directions summary", async () => {
    fetchResult = jsonResponse({
      routes: [{ summary: { lengthInMeters: 12_500, travelTimeInSeconds: 1_020 } }],
    });

    const route = await adapter.route(ORIGIN, DESTINATION);

    const url = new URL(fetchCalls[0]!);
    expect(url.pathname).toBe("/route/directions");
    expect(url.searchParams.get("query")).toBe("47.63962,-122.128331;47.6205,-122.3493");
    expect(route).toEqual({ distanceMeters: 12_500, durationSeconds: 1_020 });
  });
});

describe("mapbox adapter", () => {
  const adapter = new MapboxAdapter({ accessToken: "test-token" });

  it("geocodes with a single-result limit and maps lng/lat center to lat/lng", async () => {
    fetchResult = jsonResponse({
      features: [
        {
          center: [-122.128_331, 47.639_62],
          place_name: "123 Main St, Redmond, Washington 98052",
        },
      ],
    });

    const result = await adapter.geocode("123 Main St");

    const url = new URL(fetchCalls[0]!);
    expect(url.pathname).toBe("/geocoding/v5/mapbox.places/123%20Main%20St.json");
    expect(url.searchParams.get("limit")).toBe("1");
    expect(url.searchParams.get("access_token")).toBe("test-token");
    expect(result).toEqual({
      lat: 47.639_62,
      lng: -122.128_331,
      formatted: "123 Main St, Redmond, Washington 98052",
    });
  });

  it("returns null when mapbox reports no features", async () => {
    fetchResult = jsonResponse({ features: [] });
    expect(await adapter.geocode("nowhere")).toBeNull();
  });

  it("requests driving directions in lng,lat order and rounds to whole meters/seconds", async () => {
    fetchResult = jsonResponse({ routes: [{ distance: 12_499.6, duration: 1_019.4 }] });

    const route = await adapter.route(ORIGIN, DESTINATION);

    const url = new URL(fetchCalls[0]!);
    expect(url.pathname).toBe(
      "/directions/v5/mapbox/driving/-122.128331,47.63962;-122.3493,47.6205",
    );
    expect(route).toEqual({ distanceMeters: 12_500, durationSeconds: 1_019 });
  });
});

// ─── AWS Location Service (SDK mocked; no live calls) ───────────────────────

const aws = vi.hoisted(() => {
  const state = {
    clientConfig: null as unknown,
    sentCommands: [] as Array<{ constructor: string; input: unknown }>,
    sendResult: null as unknown,
  };
  return state;
});

vi.mock("@aws-sdk/client-location", () => {
  class LocationClient {
    constructor(config: unknown) {
      aws.clientConfig = config;
    }
    async send(command: { input: unknown }): Promise<unknown> {
      aws.sentCommands.push({ constructor: command.constructor.name, input: command.input });
      return aws.sendResult;
    }
  }
  class SearchPlaceIndexForTextCommand {
    constructor(public readonly input: unknown) {}
  }
  class CalculateRouteCommand {
    constructor(public readonly input: unknown) {}
  }
  return { LocationClient, SearchPlaceIndexForTextCommand, CalculateRouteCommand };
});

describe("aws location adapter", () => {
  const adapter = new AwsLocationAdapter(
    { region: "us-east-1", placeIndexName: "my-index", routeCalculatorName: "my-calculator" },
    { accessKeyId: "test-ak", secretAccessKey: "test-sk" },
  );

  beforeEach(() => {
    aws.clientConfig = null;
    aws.sentCommands = [];
    aws.sendResult = null;
  });

  it("configures the client with the region and static credentials", async () => {
    aws.sendResult = { Results: [] };
    await adapter.geocode("123 Main St");

    expect(aws.clientConfig).toEqual({
      region: "us-east-1",
      credentials: { accessKeyId: "test-ak", secretAccessKey: "test-sk" },
    });
  });

  it("searches the place index for text and maps the [lng, lat] point", async () => {
    aws.sendResult = {
      Results: [
        {
          Place: {
            Geometry: { Point: [-122.128_331, 47.639_62] },
            AddressNumber: "123",
            Street: "Main St",
            Municipality: "Redmond",
            Region: "WA",
          },
        },
      ],
    };

    const result = await adapter.geocode("123 Main St");

    expect(aws.sentCommands[0]?.constructor).toBe("SearchPlaceIndexForTextCommand");
    expect(aws.sentCommands[0]?.input).toEqual({
      IndexName: "my-index",
      Text: "123 Main St",
      MaxResults: 1,
    });
    expect(result).toEqual({
      lat: 47.639_62,
      lng: -122.128_331,
      formatted: "123 Main St Redmond WA",
    });
  });

  it("returns null when the place index has no results", async () => {
    aws.sendResult = { Results: [] };
    expect(await adapter.geocode("nowhere")).toBeNull();
  });

  it("calculates a route with lng/lat-ordered positions", async () => {
    aws.sendResult = { Summary: { Distance: 12_499.6, DurationSeconds: 1_019.4 } };

    const route = await adapter.route(ORIGIN, DESTINATION);

    expect(aws.sentCommands[0]?.constructor).toBe("CalculateRouteCommand");
    expect(aws.sentCommands[0]?.input).toEqual({
      CalculatorName: "my-calculator",
      DeparturePosition: [-122.128_331, 47.639_62],
      DestinationPosition: [-122.349_3, 47.620_5],
    });
    expect(route).toEqual({ distanceMeters: 12_500, durationSeconds: 1_019 });
  });
});

describe("maps adapter definitions", () => {
  it("registers the four provider adapters with key-only or config+key credentials", () => {
    expect(MAPS_ADAPTER_DEFINITIONS.map((d) => d.key)).toEqual([
      "google",
      "azure",
      "mapbox",
      "aws",
    ]);

    const google = getMapsAdapterDefinition("google");
    expect(google?.configFields).toEqual([]);
    expect(google?.secretFields[0]).toMatchObject({
      name: "apiKey",
      type: "password",
      required: true,
    });

    const azure = getMapsAdapterDefinition("azure");
    expect(azure?.secretFields[0]).toMatchObject({ name: "subscriptionKey", required: true });

    const mapbox = getMapsAdapterDefinition("mapbox");
    expect(mapbox?.secretFields[0]).toMatchObject({ name: "accessToken", required: true });

    const awsDefinition = getMapsAdapterDefinition("aws");
    expect(awsDefinition?.configFields.map((f) => f.name)).toEqual([
      "region",
      "placeIndexName",
      "routeCalculatorName",
    ]);
    expect(awsDefinition?.configFields.every((f) => f.required)).toBe(true);
    expect(awsDefinition?.secretFields.map((f) => f.name)).toEqual([
      "accessKeyId",
      "secretAccessKey",
    ]);
  });

  it("instantiates each registered adapter from configuration and secret", () => {
    expect(instantiateMapsAdapter("google", {}, { apiKey: "k" }) instanceof GoogleMapsAdapter).toBe(
      true,
    );
    expect(
      instantiateMapsAdapter("azure", {}, { subscriptionKey: "k" }) instanceof AzureMapsAdapter,
    ).toBe(true);
    expect(
      instantiateMapsAdapter("mapbox", {}, { accessToken: "k" }) instanceof MapboxAdapter,
    ).toBe(true);
    expect(
      instantiateMapsAdapter(
        "aws",
        { region: "us-east-1", placeIndexName: "i", routeCalculatorName: "c" },
        { accessKeyId: "ak", secretAccessKey: "sk" },
      ) instanceof AwsLocationAdapter,
    ).toBe(true);
  });

  it("refuses to instantiate adapters with missing credentials, config, or unknown keys", () => {
    expect(instantiateMapsAdapter("google", {}, {})).toBeNull();
    expect(instantiateMapsAdapter("azure", {}, {})).toBeNull();
    expect(instantiateMapsAdapter("mapbox", {}, {})).toBeNull();
    expect(
      instantiateMapsAdapter("aws", {}, { accessKeyId: "ak", secretAccessKey: "sk" }),
    ).toBeNull();
    expect(
      instantiateMapsAdapter(
        "aws",
        { region: "us-east-1" },
        { accessKeyId: "ak", secretAccessKey: "sk" },
      ),
    ).toBeNull();
    expect(instantiateMapsAdapter("garmin", {}, { apiKey: "k" })).toBeNull();
  });
});
