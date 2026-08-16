import {
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { BlobServiceClient, StorageSharedKeyCredential } from "@azure/storage-blob";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { FileStorageProvider, ProviderHealth } from "@/modules/integrations/contracts";
import { scopedObjectKey } from "@/modules/integrations/storage/adapters/object-key";

// ─── S3-Compatible ──────────────────────────────────────────────────────────

export type S3StorageConfig = Readonly<{
  bucket: string;
  region?: string;
  endpoint?: string;
  forcePathStyle?: boolean;
}>;

export type S3StorageSecret = Readonly<{
  accessKeyId: string;
  secretAccessKey: string;
}>;

export class S3StorageProvider implements FileStorageProvider {
  readonly key = "s3";
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: S3StorageConfig, secret: S3StorageSecret) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      region: config.region ?? "us-east-1",
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
      ...(config.forcePathStyle ? { forcePathStyle: true } : {}),
      credentials: {
        accessKeyId: secret.accessKeyId,
        secretAccessKey: secret.secretAccessKey,
      },
    });
  }

  async put(input: {
    organizationId: string;
    objectKey: string;
    contentType: string;
    body: Uint8Array;
  }): Promise<{ objectKey: string; size: number }> {
    const key = scopedObjectKey(input.organizationId, input.objectKey);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: input.contentType,
        Body: input.body,
      }),
    );
    return { objectKey: input.objectKey, size: input.body.byteLength };
  }

  async get(input: { organizationId: string; objectKey: string }): Promise<Uint8Array> {
    const key = scopedObjectKey(input.organizationId, input.objectKey);
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const bytes = await result.Body?.transformToByteArray();
    if (!bytes) throw new Error("Object not found or empty.");
    return bytes;
  }

  async delete(input: { organizationId: string; objectKey: string }): Promise<void> {
    const key = scopedObjectKey(input.organizationId, input.objectKey);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async health(): Promise<ProviderHealth> {
    try {
      // Simple check: list objects with max 1 to verify credentials and bucket access.
      const { ListObjectsV2Command } = await import("@aws-sdk/client-s3");
      await this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, MaxKeys: 1 }));
      return { status: "available" };
    } catch (error) {
      return {
        status: "unavailable",
        detail: error instanceof Error ? error.message : "Connection failed.",
      };
    }
  }
}

// ─── Azure Blob Storage (native) ────────────────────────────────────────────

export type AzureBlobStorageConfig = Readonly<{
  accountName: string;
  container: string;
  /** Defaults to core.windows.net; override for sovereign clouds. */
  endpointSuffix?: string;
}>;

export type AzureBlobStorageSecret = Readonly<{
  accountKey: string;
}>;

export class AzureBlobStorageProvider implements FileStorageProvider {
  readonly key = "azure-blob";
  private readonly containerClient: ReturnType<BlobServiceClient["getContainerClient"]>;

  constructor(config: AzureBlobStorageConfig, secret: AzureBlobStorageSecret) {
    const credential = new StorageSharedKeyCredential(config.accountName, secret.accountKey);
    const serviceClient = new BlobServiceClient(
      `https://${config.accountName}.blob.${config.endpointSuffix ?? "core.windows.net"}`,
      credential,
    );
    this.containerClient = serviceClient.getContainerClient(config.container);
  }

  async put(input: {
    organizationId: string;
    objectKey: string;
    contentType: string;
    body: Uint8Array;
  }): Promise<{ objectKey: string; size: number }> {
    const key = scopedObjectKey(input.organizationId, input.objectKey);
    await this.containerClient.getBlockBlobClient(key).upload(input.body, input.body.byteLength, {
      blobHTTPHeaders: { blobContentType: input.contentType },
    });
    return { objectKey: input.objectKey, size: input.body.byteLength };
  }

  async get(input: { organizationId: string; objectKey: string }): Promise<Uint8Array> {
    const key = scopedObjectKey(input.organizationId, input.objectKey);
    const buffer = await this.containerClient.getBlobClient(key).downloadToBuffer();
    return new Uint8Array(buffer);
  }

  async delete(input: { organizationId: string; objectKey: string }): Promise<void> {
    const key = scopedObjectKey(input.organizationId, input.objectKey);
    await this.containerClient.getBlobClient(key).deleteIfExists();
  }

  async health(): Promise<ProviderHealth> {
    try {
      const exists = await this.containerClient.exists();
      if (!exists) {
        return { status: "unavailable", detail: "Container not found or not accessible." };
      }
      return { status: "available" };
    } catch (error) {
      return {
        status: "unavailable",
        detail: error instanceof Error ? error.message : "Connection failed.",
      };
    }
  }
}

// ─── Local Filesystem ───────────────────────────────────────────────────────

export type LocalStorageConfig = Readonly<{
  basePath: string;
}>;

export class LocalStorageProvider implements FileStorageProvider {
  readonly key = "local";

  constructor(private readonly config: LocalStorageConfig) {}

  private path(organizationId: string, objectKey: string): string {
    return join(this.config.basePath, scopedObjectKey(organizationId, objectKey));
  }

  async put(input: {
    organizationId: string;
    objectKey: string;
    contentType: string;
    body: Uint8Array;
  }): Promise<{ objectKey: string; size: number }> {
    const filePath = this.path(input.organizationId, input.objectKey);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, input.body);
    return { objectKey: input.objectKey, size: input.body.byteLength };
  }

  async get(input: { organizationId: string; objectKey: string }): Promise<Uint8Array> {
    const filePath = this.path(input.organizationId, input.objectKey);
    const buffer = await readFile(filePath);
    return new Uint8Array(buffer);
  }

  async delete(input: { organizationId: string; objectKey: string }): Promise<void> {
    const filePath = this.path(input.organizationId, input.objectKey);
    await rm(filePath, { force: true });
  }

  async health(): Promise<ProviderHealth> {
    try {
      await mkdir(this.config.basePath, { recursive: true });
      return { status: "available" };
    } catch {
      return { status: "unavailable", detail: "Cannot create or access the base path." };
    }
  }
}
