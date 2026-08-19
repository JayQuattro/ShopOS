/**
 * Video connector boundary (ADR 0018): direct-upload video with provider
 * playback. Large files stream browser→provider (Mux) or through ShopOS
 * into the org's storage connector (local mode) — never buffered whole in
 * application memory. Playback is provider-HLS or a ranged GET for local.
 */
export type VideoUpload = Readonly<{
  uploadId: string;
  uploadUrl: string;
}>;

export type VideoUploadStatus = Readonly<{
  status: "pending" | "ready" | "errored";
  assetId: string | null;
  /** HLS playback id (Mux) or a ShopOS streaming URL (local). */
  playbackId: string | null;
}>;

export type VideoAdapter = {
  readonly key: string;
  createDirectUpload(
    input: Readonly<{ title: string; externalReference: string }>,
  ): Promise<VideoUpload>;
  getUpload(uploadId: string): Promise<VideoUploadStatus>;
};

// ─── Local (via the storage connector family) ───────────────────────────────

/**
 * No external provider: the upload URL is a ShopOS endpoint that streams
 * bytes into the org's storage connector (local disk in dev, S3/Azure in
 * prod); playback serves ranged GETs from the same object. No transcoding —
 * the honest trade for zero dependencies. Dev/test default.
 */
export class LocalVideoAdapter implements VideoAdapter {
  readonly key = "local";

  constructor(private readonly baseUrl: string) {}

  async createDirectUpload(
    input: Readonly<{ title: string; externalReference: string }>,
  ): Promise<VideoUpload> {
    // The external reference doubles as the upload id; the receive endpoint
    // validates the caller's tenant before writing anything.
    const uploadId = input.externalReference;
    return {
      uploadId,
      uploadUrl: `${this.baseUrl}/api/video/local/${encodeURIComponent(uploadId)}`,
    };
  }

  async getUpload(uploadId: string): Promise<VideoUploadStatus> {
    // Local uploads are ready once received; playback is the same URL
    // served as a download/stream.
    return { status: "ready", assetId: null, playbackId: uploadId };
  }
}

let localSingleton: LocalVideoAdapter | undefined;

export function getLocalVideoAdapter(baseUrl = ""): LocalVideoAdapter {
  if (!localSingleton) localSingleton = new LocalVideoAdapter(baseUrl);
  return localSingleton;
}

// ─── Mux ────────────────────────────────────────────────────────────────────

/**
 * Mux direct uploads: POST /video/v1/uploads with Basic auth returns a
 * one-time upload URL the browser PUTs the file to; Mux transcodes and the
 * asset's playback id serves HLS. `passthrough` carries our reference back.
 */
export class MuxVideoAdapter implements VideoAdapter {
  readonly key = "mux";

  constructor(private readonly secret: Readonly<{ tokenId: string; tokenSecret: string }>) {}

  async createDirectUpload(
    input: Readonly<{ title: string; externalReference: string }>,
  ): Promise<VideoUpload> {
    const auth = Buffer.from(`${this.secret.tokenId}:${this.secret.tokenSecret}`).toString(
      "base64",
    );
    const res = await fetch("https://api.mux.com/video/v1/uploads", {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        cors_origin: "*",
        new_asset_settings: {
          playback_policy: ["public"],
          passthrough: input.externalReference,
          ...(input.title ? { input_titles: [input.title] } : {}),
        },
      }),
    });
    if (!res.ok) throw new Error(`mux_create_upload_failed_${res.status}`);

    const payload = (await res.json()) as { data: { id: string; url: string } };
    if (!payload.data?.url) throw new Error("mux_upload_missing_url");
    return { uploadId: payload.data.id, uploadUrl: payload.data.url };
  }

  async getUpload(uploadId: string): Promise<VideoUploadStatus> {
    const auth = Buffer.from(`${this.secret.tokenId}:${this.secret.tokenSecret}`).toString(
      "base64",
    );
    const res = await fetch(
      `https://api.mux.com/video/v1/uploads/${encodeURIComponent(uploadId)}`,
      {
        headers: { Authorization: `Basic ${auth}` },
      },
    );
    if (!res.ok) throw new Error(`mux_get_upload_failed_${res.status}`);

    const upload = (await res.json()) as {
      data: {
        asset_id: string | null;
        // Mux markserrored uploads via the asset, not the upload row.
      };
    };
    if (!upload.data.asset_id) return { status: "pending", assetId: null, playbackId: null };

    const assetRes = await fetch(
      `https://api.mux.com/video/v1/assets/${encodeURIComponent(upload.data.asset_id)}`,
      { headers: { Authorization: `Basic ${auth}` } },
    );
    if (!assetRes.ok) throw new Error(`mux_get_asset_failed_${assetRes.status}`);
    const asset = (await assetRes.json()) as {
      data: {
        status: "preparing" | "ready" | "errored";
        playback_ids?: Array<{ id: string; policy: string }>;
      };
    };
    if (asset.data.status === "errored")
      return { status: "errored", assetId: upload.data.asset_id, playbackId: null };
    const playbackId = asset.data.playback_ids?.[0]?.id ?? null;
    return {
      status: asset.data.status === "ready" && playbackId ? "ready" : "pending",
      assetId: upload.data.asset_id,
      playbackId,
    };
  }
}
