import { describe, expect, it } from "vitest";
import {
  assertFederatedOrganizationEntry,
  FederationAccessDenied,
  type OrganizationIdentityConnection,
  type VerifiedFederatedIdentity,
} from "./federation-policy";

const connection: OrganizationIdentityConnection = {
  providerId: "atlas-entra",
  organizationId: "org-atlas",
  kind: "azure_oidc",
  issuer: "https://login.microsoftonline.com/tenant-atlas/v2.0",
  verifiedDomains: new Set(["atlas.example"]),
  azureTenantId: "tenant-atlas",
  provisioning: "invitation_only",
  enabled: true,
};

const identity: VerifiedFederatedIdentity = {
  providerId: "atlas-entra",
  issuer: "https://login.microsoftonline.com/tenant-atlas/v2.0",
  subject: "entra-user-1",
  email: "advisor@atlas.example",
  emailVerified: true,
  azureTenantId: "tenant-atlas",
};

describe("federated organization isolation", () => {
  it("allows an existing member through the bound provider", () => {
    expect(() =>
      assertFederatedOrganizationEntry(connection, identity, {
        organizationId: "org-atlas",
        hasExistingMembership: true,
      }),
    ).not.toThrow();
  });

  it("denies the same identity from a different organization", () => {
    expect(() =>
      assertFederatedOrganizationEntry(connection, identity, {
        organizationId: "org-other",
        hasExistingMembership: true,
      }),
    ).toThrowError(FederationAccessDenied);
  });

  it("denies an Azure identity from the wrong directory tenant", () => {
    expect(() =>
      assertFederatedOrganizationEntry(
        connection,
        { ...identity, azureTenantId: "tenant-other" },
        { organizationId: "org-atlas", hasExistingMembership: true },
      ),
    ).toThrowError(FederationAccessDenied);
  });

  it("requires a matching invitation for a new member", () => {
    expect(() =>
      assertFederatedOrganizationEntry(connection, identity, {
        organizationId: "org-atlas",
        hasExistingMembership: false,
        invitationOrganizationId: "org-atlas",
        invitationEmail: "advisor@atlas.example",
      }),
    ).not.toThrow();

    expect(() =>
      assertFederatedOrganizationEntry(connection, identity, {
        organizationId: "org-atlas",
        hasExistingMembership: false,
        invitationOrganizationId: "org-other",
        invitationEmail: "advisor@atlas.example",
      }),
    ).toThrowError(FederationAccessDenied);
  });

  it("requires the verified Google Workspace hosted-domain claim", () => {
    const googleConnection: OrganizationIdentityConnection = {
      providerId: "atlas-google",
      organizationId: "org-atlas",
      kind: "google_workspace_oidc",
      issuer: "https://accounts.google.com",
      verifiedDomains: new Set(["atlas.example"]),
      provisioning: "invitation_only",
      enabled: true,
    };
    const googleIdentity: VerifiedFederatedIdentity = {
      providerId: "atlas-google",
      issuer: "https://accounts.google.com",
      subject: "google-user-1",
      email: "advisor@atlas.example",
      emailVerified: true,
    };

    expect(() =>
      assertFederatedOrganizationEntry(googleConnection, googleIdentity, {
        organizationId: "org-atlas",
        hasExistingMembership: true,
      }),
    ).toThrowError(FederationAccessDenied);
  });
});
