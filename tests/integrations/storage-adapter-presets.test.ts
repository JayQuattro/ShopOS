import { describe, expect, it } from "vitest";

import {
  getStorageAdapterDefinition,
  S3_STORAGE_PRESETS,
  STORAGE_ADAPTER_DEFINITIONS,
} from "@/modules/integrations/storage/adapters/storage-adapter-types";

describe("storage adapter definitions", () => {
  it("exposes a preset select field as the first S3 config field", () => {
    const s3 = getStorageAdapterDefinition("s3");
    expect(s3).toBeDefined();

    const presetField = s3?.configFields[0];
    expect(presetField?.name).toBe("preset");
    expect(presetField?.type).toBe("select");
    expect(presetField?.required).toBe(false);
    expect(presetField?.options).toEqual(S3_STORAGE_PRESETS);
  });

  it("covers the popular S3-compatible providers", () => {
    const keys = S3_STORAGE_PRESETS.map((p) => p.value);
    for (const expected of [
      "aws",
      "r2", // Cloudflare
      "b2", // Backblaze
      "wasabi",
      "spaces", // DigitalOcean
      "oss", // Alibaba
      "gcs", // Google
      "linode",
      "scaleway",
      "vultr",
      "storj",
      "minio",
      "custom",
    ]) {
      expect(keys).toContain(expected);
    }
  });

  it("has unique preset keys", () => {
    const keys = S3_STORAGE_PRESETS.map((p) => p.value);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("uses http(s) endpoints only, with placeholders limited to template variables", () => {
    for (const preset of S3_STORAGE_PRESETS) {
      const endpoint = preset.endpoint ?? "";
      if (!endpoint) continue;
      expect(endpoint).toMatch(/^https?:\/\//);
      // Placeholders must be uppercase tokens like <REGION>, not stray brackets.
      for (const match of endpoint.matchAll(/<([^>]*)>/g)) {
        expect(match[1]).toMatch(/^[A-Z_]+$/);
      }
    }
  });

  it("marks every custom-endpoint preset as path style and Amazon S3 as virtual-hosted", () => {
    for (const preset of S3_STORAGE_PRESETS) {
      expect(preset.forcePathStyle).toBeDefined();
      if (preset.value === "aws") {
        expect(preset.forcePathStyle).toBe(false);
        expect(preset.endpoint).toBe("");
      } else if (preset.endpoint) {
        expect(preset.forcePathStyle).toBe(true);
      }
    }
  });

  it("fills a fixed region only for providers with a global region", () => {
    const regionDefaults = S3_STORAGE_PRESETS.filter((p) => p.regionDefault !== undefined).map(
      (p) => p.value,
    );
    // Cloudflare R2 and GCS are global ("auto"); MinIO and Storj use a fixed default.
    expect(regionDefaults).toContain("r2");
    expect(regionDefaults).toContain("gcs");
    // Providers that embed the region in the endpoint must not hard-code one.
    for (const templated of ["b2", "wasabi", "spaces", "oss", "linode", "scaleway", "vultr"]) {
      expect(regionDefaults).not.toContain(templated);
    }
  });

  it("does not offer an Azure S3 preset (no stable S3-compatible endpoint)", () => {
    expect(S3_STORAGE_PRESETS.find((p) => p.value === "azure")).toBeUndefined();
  });

  it("keeps required fields required and the local adapter preset-free", () => {
    const s3 = getStorageAdapterDefinition("s3");
    expect(s3?.configFields.find((f) => f.name === "bucket")?.required).toBe(true);

    const local = getStorageAdapterDefinition("local");
    expect(local?.configFields.find((f) => f.name === "preset")).toBeUndefined();
    expect(STORAGE_ADAPTER_DEFINITIONS.map((a) => a.key)).toEqual(["s3", "local"]);
  });
});
