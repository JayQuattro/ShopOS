/**
 * Tenant-scoped object key construction shared by every storage provider.
 * All object storage adapters must route keys through this function so that
 * tenant isolation is enforced at the storage layer regardless of adapter.
 */
export function scopedObjectKey(organizationId: string, objectKey: string): string {
  // Prevent path traversal and key injection.
  const safeKey = objectKey.replace(/\.\./g, "").replace(/^\/+/, "");
  return `${organizationId}/${safeKey}`;
}
