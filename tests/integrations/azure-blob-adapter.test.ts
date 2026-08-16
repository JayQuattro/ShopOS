import { describe, expect, it } from "vitest";

import { scopedObjectKey } from "@/modules/integrations/storage/adapters/object-key";
import {
  AzureBlobStorageProvider,
  S3StorageProvider,
} from "@/modules/integrations/storage/adapters/storage-providers";
import { getStorageAdapterDefinition } from "@/modules/integrations/storage/adapters/storage-adapter-types";

const FAKE_ACCOUNT_KEY = Buffer.from("not-a-real-account-key").toString("base64");

describe("tenant-scoped object keys", () => {
  it("prefixes every key with the organization id", () => {
    expect(scopedObjectKey("org-1", "work-orders/wo-1/att/file.pdf")).toBe(
      "org-1/work-orders/wo-1/att/file.pdf",
    );
  });

  it("neutralizes parent-directory traversal segments", () => {
    const key = scopedObjectKey("org-1", "../../other-org/secret.pdf");
    expect(key.startsWith("other-org/")).toBe(false);
    expect(key.startsWith("/")).toBe(false);
    expect(key.startsWith("org-1/")).toBe(true);
  });

  it("strips leading slashes so keys stay under the organization prefix", () => {
    expect(scopedObjectKey("org-1", "/absolute/path.txt")).toBe("org-1/absolute/path.txt");
  });

  it("cannot be coerced into another organization's namespace", () => {
    // Even a crafted key naming another org stays nested under the caller's prefix.
    expect(scopedObjectKey("org-1", "org-2/invoice.pdf")).toBe("org-1/org-2/invoice.pdf");
  });
});

describe("azure blob storage adapter", () => {
  it("registers the adapter definition with account/container config and a write-only key", () => {
    const definition = getStorageAdapterDefinition("azure-blob");
    expect(definition).toBeDefined();
    expect(definition?.displayName).toBe("Azure Blob Storage");

    const configNames = definition?.configFields.map((f) => f.name);
    expect(configNames).toEqual(["accountName", "container", "endpointSuffix"]);
    expect(definition?.configFields.find((f) => f.name === "accountName")?.required).toBe(true);
    expect(definition?.configFields.find((f) => f.name === "container")?.required).toBe(true);
    expect(definition?.configFields.find((f) => f.name === "endpointSuffix")?.required).toBe(false);
    expect(definition?.configFields.find((f) => f.name === "preset")).toBeUndefined();

    const secretField = definition?.secretFields.find((f) => f.name === "accountKey");
    expect(secretField?.required).toBe(true);
    expect(secretField?.type).toBe("password");
  });

  it("constructs the provider offline with shared-key credentials", () => {
    const provider = new AzureBlobStorageProvider(
      { accountName: "shoposstorage", container: "shopos-files" },
      { accountKey: FAKE_ACCOUNT_KEY },
    );
    expect(provider.key).toBe("azure-blob");
  });

  it("constructs with a sovereign-cloud endpoint suffix", () => {
    const provider = new AzureBlobStorageProvider(
      {
        accountName: "shoposstorage",
        container: "shopos-files",
        endpointSuffix: "core.usgovcloudapi.net",
      },
      { accountKey: FAKE_ACCOUNT_KEY },
    );
    expect(provider.key).toBe("azure-blob");
  });
});

describe("s3 storage adapter", () => {
  it("still constructs alongside the azure adapter", () => {
    const provider = new S3StorageProvider(
      { bucket: "shopos-files", region: "us-east-1" },
      { accessKeyId: "key", secretAccessKey: "secret" },
    );
    expect(provider.key).toBe("s3");
  });
});
