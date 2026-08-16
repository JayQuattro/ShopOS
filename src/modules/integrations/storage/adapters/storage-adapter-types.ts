/**
 * Storage adapter definitions for the connector configuration UI.
 *
 * Each adapter implements the FileStorageProvider interface from
 * src/modules/integrations/contracts.ts (ADR 0008). Objects are always
 * namespaced by organizationId to enforce tenant isolation.
 */

export type StorageAdapterDefinition = Readonly<{
  key: string;
  displayName: string;
  description: string;
  configFields: ReadonlyArray<{
    name: string;
    label: string;
    type: "text" | "number" | "boolean";
    required: boolean;
    placeholder?: string;
  }>;
  secretFields: ReadonlyArray<{
    name: string;
    label: string;
    type: "text" | "password";
    required: boolean;
    placeholder?: string;
  }>;
}>;

export const STORAGE_ADAPTER_DEFINITIONS: ReadonlyArray<StorageAdapterDefinition> = [
  {
    key: "s3",
    displayName: "S3-Compatible",
    description:
      "Amazon S3, Cloudflare R2, MinIO, Backblaze B2, DigitalOcean Spaces, Wasabi, or any S3-compatible object storage.",
    configFields: [
      {
        name: "bucket",
        label: "Bucket Name",
        type: "text",
        required: true,
        placeholder: "my-shopos-files",
      },
      { name: "region", label: "Region", type: "text", required: false, placeholder: "us-east-1" },
      {
        name: "endpoint",
        label: "Custom Endpoint (optional)",
        type: "text",
        required: false,
        placeholder: "https://xxx.r2.cloudflarestorage.com",
      },
      {
        name: "forcePathStyle",
        label: "Force Path Style (MinIO/R2)",
        type: "boolean",
        required: false,
      },
    ],
    secretFields: [
      { name: "accessKeyId", label: "Access Key ID", type: "text", required: true },
      { name: "secretAccessKey", label: "Secret Access Key", type: "password", required: true },
    ],
  },
  {
    key: "local",
    displayName: "Local Filesystem",
    description:
      "Store files on the server's local disk. Simple for single-server self-hosted deployments. Not suitable for multi-server or containerized deployments without a persistent volume.",
    configFields: [
      {
        name: "basePath",
        label: "Base Path",
        type: "text",
        required: true,
        placeholder: "/var/lib/shopos/files",
      },
    ],
    secretFields: [],
  },
];

export function getStorageAdapterDefinition(key: string): StorageAdapterDefinition | undefined {
  return STORAGE_ADAPTER_DEFINITIONS.find((a) => a.key === key);
}
