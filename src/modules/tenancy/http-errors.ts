import { TenantContextNotResolved } from "@/modules/tenancy/resolve-tenant-context";
import { TenantAccessDenied } from "@/modules/tenancy/policy";

/**
 * Maps the tenant authorization and resolution errors to HTTP statuses. Returns
 * 401 when there is no authenticated session or selected organization, 403 when
 * the actor lacks permission, and a generic 500 otherwise — never leaking
 * whether a resource exists in another tenant. Shared across protected routes.
 */
export function mapTenantError(error: unknown): Response {
  if (error instanceof TenantContextNotResolved) {
    return Response.json({ error: error.reason }, { status: 401 });
  }
  if (error instanceof TenantAccessDenied) {
    return Response.json({ error: error.reason }, { status: 403 });
  }
  return Response.json({ error: "internal_error" }, { status: 500 });
}
