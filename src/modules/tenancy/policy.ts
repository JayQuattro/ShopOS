export type Permission =
  | "organizations.manage"
  | "memberships.manage"
  | "customers.read"
  | "customers.write"
  | "assets.read"
  | "assets.write"
  | "work_orders.read"
  | "work_orders.write"
  | "estimates.present"
  | "authorizations.record"
  | "invoices.issue"
  | "payments.record";

export type TenantContext = Readonly<{
  actorId: string;
  organizationId: string;
  membershipId: string;
  requestId: string;
  selectedLocationId?: string;
  organizationWideLocationAccess: boolean;
  allowedLocationIds: ReadonlySet<string>;
  permissions: ReadonlySet<Permission>;
}>;

export type TenantOwnedResource = Readonly<{
  organizationId: string;
  locationId?: string | null;
}>;

export function assertTenantAccess(
  context: TenantContext,
  resource: TenantOwnedResource,
  permission: Permission,
): void {
  if (!context.permissions.has(permission)) {
    throw new TenantAccessDenied("permission_denied");
  }

  if (resource.organizationId !== context.organizationId) {
    throw new TenantAccessDenied("organization_denied");
  }

  if (!resource.locationId) {
    return;
  }

  if (context.selectedLocationId && resource.locationId !== context.selectedLocationId) {
    throw new TenantAccessDenied("location_denied");
  }

  if (
    !context.organizationWideLocationAccess &&
    !context.allowedLocationIds.has(resource.locationId)
  ) {
    throw new TenantAccessDenied("location_denied");
  }
}

export function assertLocationCanBeSelected(
  context: Omit<TenantContext, "selectedLocationId">,
  locationId: string,
): void {
  if (!context.organizationWideLocationAccess && !context.allowedLocationIds.has(locationId)) {
    throw new TenantAccessDenied("location_denied");
  }
}

export class TenantAccessDenied extends Error {
  readonly reason: "permission_denied" | "organization_denied" | "location_denied";

  constructor(reason: "permission_denied" | "organization_denied" | "location_denied") {
    super("The requested resource was not found or is not available in this tenant context.");
    this.name = "TenantAccessDenied";
    this.reason = reason;
  }
}
