/**
 * Storage adapter definitions for the connector configuration UI.
 *
 * Each adapter implements the FileStorageProvider interface from
 * src/modules/integrations/contracts.ts (ADR 0008). Objects are always
 * namespaced by organizationId to enforce tenant isolation.
 */

/**
 * A select option that can also auto-fill related config fields when chosen.
 * Used by the "preset" field on the S3 adapter: picking Cloudflare R2 fills in
 * the endpoint template, the region, and forcePathStyle.
 */
export type StorageConfigFieldOption = Readonly<{
  value: string;
  label: string;
  /** Endpoint template placed in the endpoint field. Empty = clear it. */
  endpoint?: string;
  /** Example region shown as the placeholder for the region field. */
  regionHint?: string;
  /** Region value filled in when the provider has a fixed/global region. */
  regionDefault?: string;
  /** Value applied to the forcePathStyle boolean. */
  forcePathStyle?: boolean;
  /** Extra guidance rendered under the select. */
  note?: string;
}>;

export type StorageAdapterDefinition = Readonly<{
  key: string;
  displayName: string;
  description: string;
  configFields: ReadonlyArray<{
    name: string;
    label: string;
    type: "text" | "number" | "boolean" | "select";
    required: boolean;
    placeholder?: string;
    options?: ReadonlyArray<StorageConfigFieldOption>;
  }>;
  secretFields: ReadonlyArray<{
    name: string;
    label: string;
    type: "text" | "password";
    required: boolean;
    placeholder?: string;
  }>;
}>;

/**
 * Presets for popular S3-compatible object storage providers. Endpoint
 * templates may contain <PLACEHOLDER> segments the operator replaces with
 * their account or region values. Azure Blob Storage is intentionally absent:
 * it has no stable S3-compatible endpoint and needs a native adapter instead.
 */
export const S3_STORAGE_PRESETS: ReadonlyArray<StorageConfigFieldOption> = [
  {
    value: "aws",
    label: "Amazon S3",
    endpoint: "",
    regionHint: "us-east-1",
    forcePathStyle: false,
    note: "Leave the endpoint empty to use Amazon's default regional endpoints.",
  },
  {
    value: "r2",
    label: "Cloudflare R2",
    endpoint: "https://<ACCOUNT_ID>.r2.cloudflarestorage.com",
    regionHint: "auto",
    regionDefault: "auto",
    forcePathStyle: true,
    note: "Replace <ACCOUNT_ID> with your Cloudflare account ID from the R2 dashboard.",
  },
  {
    value: "b2",
    label: "Backblaze B2",
    endpoint: "https://s3.<REGION>.backblazeb2.com",
    regionHint: "us-west-004",
    forcePathStyle: true,
    note: "Replace <REGION> with your bucket's region as shown on its B2 bucket page.",
  },
  {
    value: "wasabi",
    label: "Wasabi",
    endpoint: "https://s3.<REGION>.wasabisys.com",
    regionHint: "us-east-1",
    forcePathStyle: true,
    note: "Replace <REGION> with your Wasabi region, e.g. us-east-1, eu-central-2, ap-northeast-1.",
  },
  {
    value: "spaces",
    label: "DigitalOcean Spaces",
    endpoint: "https://<REGION>.digitaloceanspaces.com",
    regionHint: "nyc3",
    forcePathStyle: true,
    note: "Replace <REGION> with your Space's region, e.g. nyc3, ams3, sgp1, fra1.",
  },
  {
    value: "oss",
    label: "Alibaba Cloud OSS",
    endpoint: "https://oss-<REGION>.aliyuncs.com",
    regionHint: "cn-hangzhou",
    forcePathStyle: true,
    note: "Replace <REGION> with your OSS region, e.g. cn-hangzhou, us-west-1, ap-southeast-1.",
  },
  {
    value: "gcs",
    label: "Google Cloud Storage",
    endpoint: "https://storage.googleapis.com",
    regionHint: "auto",
    regionDefault: "auto",
    forcePathStyle: true,
    note: "Uses the GCS S3-compatible XML API. Create HMAC access keys in the GCS console.",
  },
  {
    value: "linode",
    label: "Akamai (Linode) Object Storage",
    endpoint: "https://<REGION>.linodeobjects.com",
    regionHint: "us-east-1",
    forcePathStyle: true,
    note: "Replace <REGION> with your cluster, e.g. us-east-1, eu-central-1, ap-south-1.",
  },
  {
    value: "scaleway",
    label: "Scaleway Object Storage",
    endpoint: "https://s3.<REGION>.scw.cloud",
    regionHint: "fr-par",
    forcePathStyle: true,
    note: "Replace <REGION> with your Scaleway zone, e.g. fr-par, nl-ams, pl-waw.",
  },
  {
    value: "vultr",
    label: "Vultr Object Storage",
    endpoint: "https://<REGION>.vultrobjects.com",
    regionHint: "ewr1",
    forcePathStyle: true,
    note: "Replace <REGION> with your Vultr location, e.g. ewr1, sjc1, ams1.",
  },
  {
    value: "storj",
    label: "Storj",
    endpoint: "https://gateway.storjshare.io",
    regionHint: "us-east-1",
    regionDefault: "us-east-1",
    forcePathStyle: true,
    note: "Uses Storj's hosted S3-compatible gateway with your access grant credentials.",
  },
  {
    value: "minio",
    label: "MinIO (self-hosted)",
    endpoint: "http://localhost:9000",
    regionHint: "us-east-1",
    regionDefault: "us-east-1",
    forcePathStyle: true,
    note: "Point the endpoint at your MinIO deployment; use https in production.",
  },
  {
    value: "custom",
    label: "Custom / Other S3-Compatible",
    endpoint: "",
    forcePathStyle: true,
    note: "Enter the endpoint, region, and bucket details from your provider.",
  },
];

export const STORAGE_ADAPTER_DEFINITIONS: ReadonlyArray<StorageAdapterDefinition> = [
  {
    key: "s3",
    displayName: "S3-Compatible",
    description:
      "Amazon S3, Cloudflare R2, Backblaze B2, Wasabi, DigitalOcean Spaces, Alibaba OSS, Google Cloud Storage, MinIO, and any other S3-compatible object storage. Pick a preset to auto-fill the endpoint.",
    configFields: [
      {
        name: "preset",
        label: "Provider Preset",
        type: "select",
        required: false,
        placeholder: "Choose your storage provider…",
        options: S3_STORAGE_PRESETS,
      },
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
        label: "Force Path Style",
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
    key: "azure-blob",
    displayName: "Azure Blob Storage",
    description:
      "Native Azure Blob Storage adapter using the official Azure SDK with shared-key auth. No S3 gateway required; recommended over S3 presets when your files live in Azure.",
    configFields: [
      {
        name: "accountName",
        label: "Storage Account Name",
        type: "text",
        required: true,
        placeholder: "myshoposstorage",
      },
      {
        name: "container",
        label: "Container Name",
        type: "text",
        required: true,
        placeholder: "shopos-files",
      },
      {
        name: "endpointSuffix",
        label: "Endpoint Suffix (optional)",
        type: "text",
        required: false,
        placeholder: "core.windows.net",
      },
    ],
    secretFields: [
      {
        name: "accountKey",
        label: "Account Key",
        type: "password",
        required: true,
        placeholder: "Base64 key from Access keys in the Azure portal",
      },
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
