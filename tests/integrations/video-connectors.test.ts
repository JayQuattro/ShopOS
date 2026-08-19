import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getLocalVideoAdapter, MuxVideoAdapter } from "@/modules/integrations/video/video-adapters";
import { VIDEO_ADAPTER_DEFINITIONS } from "@/modules/integrations/video/video-connector-service";

const fetchCalls: string[] = [];
let fetchResult: unknown = null;

beforeEach(() => {
  fetchCalls.length = 0;
  fetchResult = null;
  vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
    const headers = init?.headers as Record<string, string> | undefined;
    fetchCalls.push(String(url));
    fetchCalls.push(String(headers?.Authorization ?? ""));
    fetchCalls.push(String(init?.body ?? ""));
    return { ok: true, json: () => Promise.resolve(fetchResult) } as unknown as Response;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("local video adapter", () => {
  it("issues an internal upload URL keyed by the external reference", async () => {
    const adapter = getLocalVideoAdapter("https://shop.example.test");
    const upload = await adapter.createDirectUpload({
      title: "Brake rotor video",
      externalReference: "insp-item-1",
    });

    expect(upload.uploadId).toBe("insp-item-1");
    expect(upload.uploadUrl).toBe("https://shop.example.test/api/video/local/insp-item-1");
    // Local uploads are ready immediately; playback is the same reference.
    expect(await adapter.getUpload("insp-item-1")).toEqual({
      status: "ready",
      assetId: null,
      playbackId: "insp-item-1",
    });
  });
});

describe("mux video adapter", () => {
  const adapter = new MuxVideoAdapter({ tokenId: "tok", tokenSecret: "sec" });

  it("creates a direct upload with passthrough and public playback", async () => {
    fetchResult = { data: { id: "upload_123", url: "https://storage.googleapis.com/mux/abc" } };
    const upload = await adapter.createDirectUpload({
      title: "Brake rotor video",
      externalReference: "insp-item-1",
    });

    expect(fetchCalls[0]).toBe("https://api.mux.com/video/v1/uploads");
    expect(fetchCalls[1]).toBe(`Basic ${Buffer.from("tok:sec").toString("base64")}`);
    const body = JSON.parse(fetchCalls[2]!);
    expect(body.new_asset_settings.passthrough).toBe("insp-item-1");
    expect(body.new_asset_settings.playback_policy).toEqual(["public"]);
    expect(upload).toEqual({
      uploadId: "upload_123",
      uploadUrl: "https://storage.googleapis.com/mux/abc",
    });
  });

  it("reports pending before the asset exists, ready with a playback id after", async () => {
    fetchResult = { data: { asset_id: null } };
    expect(await adapter.getUpload("upload_123")).toEqual({
      status: "pending",
      assetId: null,
      playbackId: null,
    });

    vi.unstubAllGlobals();
    let call = 0;
    vi.stubGlobal("fetch", async (_url: string | URL) => {
      call += 1;
      if (call === 1) {
        return {
          ok: true,
          json: () => Promise.resolve({ data: { asset_id: "asset_9" } }),
        } as unknown as Response;
      }
      return {
        ok: true,
        json: () =>
          Promise.resolve({
            data: { status: "ready", playback_ids: [{ id: "play_77", policy: "public" }] },
          }),
      } as unknown as Response;
    });

    const status = await adapter.getUpload("upload_123");
    expect(status).toEqual({ status: "ready", assetId: "asset_9", playbackId: "play_77" });
  });
});

describe("video adapter definitions", () => {
  it("registers mux live with token-pair secrets and the stream slots planned", () => {
    expect(VIDEO_ADAPTER_DEFINITIONS.map((d) => d.key)).toEqual([
      "mux",
      "cloudflare-stream",
      "api-video",
      "bunny-stream",
    ]);
    const mux = VIDEO_ADAPTER_DEFINITIONS[0]!;
    expect(mux.status).toBe("live");
    expect(mux.secretFields.map((f) => f.name)).toEqual(["tokenId", "tokenSecret"]);
    expect(VIDEO_ADAPTER_DEFINITIONS.slice(1).every((d) => d.status === "planned")).toBe(true);
  });
});
