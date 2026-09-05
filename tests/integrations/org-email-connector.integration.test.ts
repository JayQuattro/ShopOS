import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { assertDedicatedTestDatabase, resetTestDatabase } from "../helpers/database";

const TEST_DATABASE_URL =
  process.env.SHOPOS_TEST_DATABASE_URL ?? "postgres://shopos:shopos@localhost:5432/shopos_test";
assertDedicatedTestDatabase(TEST_DATABASE_URL);

const env = process.env as Record<string, string | undefined>;
env.DATABASE_URL = TEST_DATABASE_URL;
env.BETTER_AUTH_URL = "http://localhost:3000";
env.BETTER_AUTH_SECRET = "integration-test-secret-at-least-32-characters-long";
env.NODE_ENV = "test";

function isPostgresReachable(url: string): boolean {
  try {
    const probePath = new URL("../identity/_probe-postgres.cjs", import.meta.url);
    execFileSync(process.execPath, [fileURLToPath(probePath)], {
      timeout: 3_000,
      stdio: "ignore",
      env: { ...process.env, SHOPOS_PROBE_URL: url },
    });
    return true;
  } catch {
    return false;
  }
}

const RUN = isPostgresReachable(TEST_DATABASE_URL);
const shouldSkip = !RUN;

type DbModule = typeof import("@/db/client");
let dbModule: DbModule;

const savedEnv: Record<string, string | undefined> = {};

beforeAll(async () => {
  if (!RUN) return;
  dbModule = await import("@/db/client");
  await resetTestDatabase(dbModule.db);
}, 30_000);

afterAll(async () => {
  if (!RUN) return;
  env.CONNECTOR_ENCRYPTION_KEY = savedEnv.CONNECTOR_ENCRYPTION_KEY;
  await resetTestDatabase(dbModule.db);
  await dbModule.db.$disconnect();
});

beforeEach(async () => {
  if (!RUN) return;
  if (!("CONNECTOR_ENCRYPTION_KEY" in savedEnv)) {
    savedEnv.CONNECTOR_ENCRYPTION_KEY = env.CONNECTOR_ENCRYPTION_KEY;
  }
  const { generateMasterKey } = await import("@/modules/integrations/crypto/secret-cipher");
  env.CONNECTOR_ENCRYPTION_KEY = generateMasterKey();
  await resetTestDatabase(dbModule.db);
});

/**
 * Seeds an organization with an owner membership. No OrganizationEntitlement
 * rows are created: connector configuration must work out of the box for a
 * self-hosted organization with no plan materialized.
 */
async function seedOrg(options?: { managePermission?: boolean }) {
  const orgId = randomUUID();
  const userId = randomUUID();
  const membershipId = randomUUID();
  const roleId = randomUUID();

  const manage = options?.managePermission ?? true;

  await dbModule.db.$transaction([
    dbModule.db.organization.create({
      data: { id: orgId, slug: `org-${orgId.slice(0, 8)}`, name: "Connector Org" },
    }),
    dbModule.db.user.create({
      data: {
        id: userId,
        email: `c-${userId.slice(0, 8)}@example.test`,
        displayName: "Connector User",
      },
    }),
    dbModule.db.organizationMembership.create({
      data: {
        id: membershipId,
        organizationId: orgId,
        userId,
        organizationWideLocationAccess: true,
      },
    }),
    dbModule.db.role.create({
      data: {
        id: roleId,
        organizationId: orgId,
        key: manage ? "owner" : "technician",
        name: manage ? "Owner" : "Technician",
        permissions: manage ? ["organizations.manage"] : ["work_orders.read"],
      },
    }),
    dbModule.db.membershipRole.create({ data: { organizationId: orgId, membershipId, roleId } }),
  ]);

  const context = () =>
    ({
      actorId: userId,
      organizationId: orgId,
      membershipId,
      requestId: randomUUID(),
      organizationWideLocationAccess: true,
      allowedLocationIds: new Set<string>(),
      permissions: new Set<string>(manage ? ["organizations.manage"] : ["work_orders.read"]),
    }) as import("@/modules/tenancy/policy").TenantContext;

  return { orgId, context };
}

describe("organization email connector configuration", { skip: shouldSkip }, () => {
  it("configures Zoho ZeptoMail with no materialized plan entitlements", async () => {
    const { upsertOrgEmailConnector, getOrgEmailConnector } =
      await import("@/modules/integrations/org-connectors");
    const { orgId, context } = await seedOrg();

    // Explicitly prove no entitlement rows exist for this organization.
    const entitlementCount = await dbModule.db.organizationEntitlement.count({
      where: { organizationId: orgId },
    });
    expect(entitlementCount).toBe(0);

    const created = await upsertOrgEmailConnector({
      db: dbModule.db,
      context: context(),
      adapterKey: "zoho-zepto",
      displayName: "Shop ZeptoMail",
      configuration: { fromAddress: "service@shop.example", fromName: "Atlas Service" },
      secret: { sendMailToken: "zepto_test_token_123" },
    });
    expect(created.connectorId).toBeTruthy();

    const read = await getOrgEmailConnector(dbModule.db, context());
    expect(read?.adapterKey).toBe("zoho-zepto");
    expect(read?.displayName).toBe("Shop ZeptoMail");
    expect(read?.hasSecret).toBe(true);
    expect(read?.configuration).toMatchObject({ fromAddress: "service@shop.example" });

    const raw = await dbModule.db.connectorInstance.findFirst({
      where: { organizationId: orgId, capability: "email_delivery" },
      select: { encryptedSecret: true, scope: true },
    });
    expect(raw?.scope).toBe("organization");
    expect(raw?.encryptedSecret).toBeTruthy();
    expect(raw?.encryptedSecret).not.toContain("zepto_test_token_123");

    const audit = await dbModule.db.auditEvent.findFirst({
      where: { organizationId: orgId, action: "integrations.connector_configured" },
    });
    expect(audit).not.toBeNull();
  });

  it("rotates to another provider, disabling the previous active connector", async () => {
    const { upsertOrgEmailConnector } = await import("@/modules/integrations/org-connectors");
    const { orgId, context } = await seedOrg();

    const first = await upsertOrgEmailConnector({
      db: dbModule.db,
      context: context(),
      adapterKey: "zoho-zepto",
      displayName: "Zepto",
      configuration: { fromAddress: "service@shop.example" },
      secret: { sendMailToken: "token_one" },
    });
    const second = await upsertOrgEmailConnector({
      db: dbModule.db,
      context: context(),
      adapterKey: "smtp",
      displayName: "SMTP relay",
      configuration: {
        host: "smtp.zeptomail.com",
        port: "587",
        fromAddress: "service@shop.example",
      },
      secret: { username: "smtp-user", password: "smtp-pass" },
    });
    expect(second.connectorId).not.toBe(first.connectorId);

    const statuses = await dbModule.db.connectorInstance.findMany({
      where: { organizationId: orgId, capability: "email_delivery" },
      select: { id: true, status: true },
    });
    expect(statuses.find((c) => c.id === first.connectorId)?.status).toBe("disabled");
    expect(statuses.find((c) => c.id === second.connectorId)?.status).toBe("active");
  });

  it("rejects invalid adapters and missing required fields", async () => {
    const { upsertOrgEmailConnector } = await import("@/modules/integrations/org-connectors");
    const { context } = await seedOrg();

    await expect(
      upsertOrgEmailConnector({
        db: dbModule.db,
        context: context(),
        adapterKey: "carrier-pigeon",
        displayName: "Nope",
        configuration: {},
        secret: {},
      }),
    ).rejects.toMatchObject({ reason: "invalid_adapter" });

    await expect(
      upsertOrgEmailConnector({
        db: dbModule.db,
        context: context(),
        adapterKey: "zoho-zepto",
        displayName: "Missing token",
        configuration: { fromAddress: "service@shop.example" },
        secret: {},
      }),
    ).rejects.toMatchObject({ reason: "invalid_configuration" });
  });

  it("denies configuration without organizations.manage", async () => {
    const { upsertOrgEmailConnector } = await import("@/modules/integrations/org-connectors");
    const { context } = await seedOrg({ managePermission: false });

    await expect(
      upsertOrgEmailConnector({
        db: dbModule.db,
        context: context(),
        adapterKey: "zoho-zepto",
        displayName: "Denied",
        configuration: { fromAddress: "service@shop.example" },
        secret: { sendMailToken: "token" },
      }),
    ).rejects.toMatchObject({ reason: "permission_denied" });
  });

  it("deletes the connector and reports when nothing remains", async () => {
    const { upsertOrgEmailConnector, deleteOrgEmailConnector } =
      await import("@/modules/integrations/org-connectors");
    const { orgId, context } = await seedOrg();

    await upsertOrgEmailConnector({
      db: dbModule.db,
      context: context(),
      adapterKey: "zoho-zepto",
      displayName: "Zepto",
      configuration: { fromAddress: "service@shop.example" },
      secret: { sendMailToken: "token" },
    });

    await deleteOrgEmailConnector({ db: dbModule.db, context: context() });
    expect(await dbModule.db.connectorInstance.count({ where: { organizationId: orgId } })).toBe(0);

    await expect(
      deleteOrgEmailConnector({ db: dbModule.db, context: context() }),
    ).rejects.toMatchObject({ reason: "connector_not_found" });
  });
});
