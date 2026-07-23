export type FederationKind = "azure_oidc" | "google_workspace_oidc" | "oidc" | "saml";
export type FederationProvisioning = "existing_members_only" | "invitation_only";

export type OrganizationIdentityConnection = Readonly<{
  providerId: string;
  organizationId: string;
  kind: FederationKind;
  issuer: string;
  verifiedDomains: ReadonlySet<string>;
  azureTenantId?: string;
  provisioning: FederationProvisioning;
  enabled: boolean;
}>;

export type VerifiedFederatedIdentity = Readonly<{
  providerId: string;
  issuer: string;
  subject: string;
  email: string;
  emailVerified: boolean;
  azureTenantId?: string;
  googleHostedDomain?: string;
}>;

export type OrganizationEntryRequest = Readonly<{
  organizationId: string;
  hasExistingMembership: boolean;
  invitationOrganizationId?: string;
  invitationEmail?: string;
}>;

/**
 * Defense-in-depth policy applied after Better Auth has validated the OIDC or SAML response.
 * It authorizes entry to a ShopOS organization; it does not validate protocol tokens.
 */
export function assertFederatedOrganizationEntry(
  connection: OrganizationIdentityConnection,
  identity: VerifiedFederatedIdentity,
  request: OrganizationEntryRequest,
): void {
  if (!connection.enabled) {
    throw new FederationAccessDenied("connection_disabled");
  }

  if (
    connection.organizationId !== request.organizationId ||
    connection.providerId !== identity.providerId
  ) {
    throw new FederationAccessDenied("organization_provider_mismatch");
  }

  if (normalizeIssuer(connection.issuer) !== normalizeIssuer(identity.issuer)) {
    throw new FederationAccessDenied("issuer_mismatch");
  }

  if (!identity.emailVerified) {
    throw new FederationAccessDenied("email_unverified");
  }

  const email = normalizeEmail(identity.email);
  const emailDomain = email.split("@")[1];

  if (!emailDomain || !hasDomain(connection.verifiedDomains, emailDomain)) {
    throw new FederationAccessDenied("domain_mismatch");
  }

  if (connection.kind === "azure_oidc") {
    if (
      !connection.azureTenantId ||
      connection.azureTenantId.toLowerCase() !== identity.azureTenantId?.toLowerCase()
    ) {
      throw new FederationAccessDenied("azure_tenant_mismatch");
    }
  }

  if (connection.kind === "google_workspace_oidc") {
    const hostedDomain = identity.googleHostedDomain?.toLowerCase();
    if (
      !hostedDomain ||
      hostedDomain !== emailDomain ||
      !hasDomain(connection.verifiedDomains, hostedDomain)
    ) {
      throw new FederationAccessDenied("google_workspace_mismatch");
    }
  }

  if (request.hasExistingMembership) {
    return;
  }

  if (connection.provisioning === "existing_members_only") {
    throw new FederationAccessDenied("membership_required");
  }

  const invitationMatches =
    request.invitationOrganizationId === connection.organizationId &&
    request.invitationEmail !== undefined &&
    normalizeEmail(request.invitationEmail) === email;

  if (!invitationMatches) {
    throw new FederationAccessDenied("invitation_required");
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizeIssuer(issuer: string): string {
  return issuer.trim().replace(/\/+$/, "");
}

function hasDomain(domains: ReadonlySet<string>, expected: string): boolean {
  return [...domains].some((domain) => domain.trim().toLowerCase() === expected);
}

export class FederationAccessDenied extends Error {
  readonly reason:
    | "connection_disabled"
    | "organization_provider_mismatch"
    | "issuer_mismatch"
    | "email_unverified"
    | "domain_mismatch"
    | "azure_tenant_mismatch"
    | "google_workspace_mismatch"
    | "membership_required"
    | "invitation_required";

  constructor(reason: FederationAccessDenied["reason"]) {
    super("Federated identity is not authorized for the requested organization.");
    this.name = "FederationAccessDenied";
    this.reason = reason;
  }
}
