import type { PrismaClient } from "@/generated/prisma/client";

export function assertDedicatedTestDatabase(databaseUrl: string): void {
  const databaseName = new URL(databaseUrl).pathname.split("/").filter(Boolean).at(-1);
  if (databaseName !== "shopos_test") {
    throw new Error(
      `Integration tests require the dedicated shopos_test database; received ${databaseName ?? "none"}.`,
    );
  }
}

export async function resetTestDatabase(
  db: Pick<PrismaClient, "$executeRawUnsafe">,
): Promise<void> {
  // Truncate all tenant-owned, platform, auth, and audit data tables. Listing
  // them explicitly (rather than cascading from the two aggregate roots) is
  // required because several tables — outbox_events, audit_events, customers,
  // assets, work_orders — reference organizations(id) with ON DELETE RESTRICT,
  // which blocks a CASCADE truncate of organizations. Enum/lookup tables are
  // excluded (they hold static reference data, not per-test rows). RESTART
  // IDENTITY resets serial/sequence counters so deterministic UUIDs remain
  // stable. CASCADE covers any remaining ON DELETE CASCADE FKs.
  await db.$executeRawUnsafe(`
    TRUNCATE TABLE
      "outbox_events",
      "audit_events",
      "platform_audit_events",
      "organization_provisioning_requests",
      "organization_entitlements",
      "organization_invitations",
      "organization_sso_providers",
      "platform_operator_grants",
      "location_access",
      "membership_roles",
      "roles",
      "organization_memberships",
      "locations",
      "payments",
      "invoice_lines",
      "invoices",
      "authorization_decisions",
      "authorizations",
      "estimate_lines",
      "estimate_revisions",
      "activity_events",
      "work_orders",
      "automotive_asset_profiles",
      "equipment_asset_profiles",
      "assets",
      "customer_addresses",
      "customer_contacts",
      "customers",
      "auth_passkeys",
      "auth_two_factors",
      "auth_sessions",
      "auth_accounts",
      "organizations",
      "users",
      "auth_verifications"
    RESTART IDENTITY CASCADE
  `);
}
