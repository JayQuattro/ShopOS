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
env.AUTH_EMAIL_DELIVERY = "console";

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

beforeAll(async () => {
  if (!RUN) return;
  dbModule = await import("@/db/client");
  await resetTestDatabase(dbModule.db);
}, 30_000);

const savedEnv: Record<string, string | undefined> = {};

afterAll(async () => {
  if (!RUN) return;
  // Restore env vars so other test files aren't affected.
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }
  // Clear the email delivery cache.
  const { invalidateEmailDeliveryCache } =
    await import("@/modules/integrations/email/email-delivery-resolver");
  invalidateEmailDeliveryCache();

  await resetTestDatabase(dbModule.db);
  await dbModule.db.$disconnect();
});

beforeEach(async () => {
  if (!RUN) return;
  // Save env vars on first use so afterAll can restore.
  if (!("CONNECTOR_ENCRYPTION_KEY" in savedEnv)) {
    savedEnv.CONNECTOR_ENCRYPTION_KEY = env.CONNECTOR_ENCRYPTION_KEY;
  }
  await resetTestDatabase(dbModule.db);
});

async function seedPlatformAdmin() {
  const adminId = randomUUID();
  await dbModule.db.user.create({
    data: {
      id: adminId,
      email: `conn-${adminId.slice(0, 8)}@example.test`,
      displayName: "Connector Admin",
      emailVerified: true,
      twoFactorEnabled: true,
    },
  });
  await dbModule.db.platformOperatorGrant.create({
    data: { id: randomUUID(), userId: adminId, role: "ADMIN", reason: "Connector test grant." },
  });

  const { resolvePlatformContext } = await import("@/modules/platform/authorization");
  return resolvePlatformContext({
    db: dbModule.db,
    actorId: adminId,
    requestId: `test-${randomUUID()}`,
  });
}

describe("email connector management", { skip: shouldSkip }, () => {
  it("creates, reads, and tests a platform email connector", async () => {
    const { getPlatformEmailConnector, upsertPlatformEmailConnector, testPlatformEmailConnector } =
      await import("@/modules/platform/connectors");
    const { generateMasterKey } = await import("@/modules/integrations/crypto/secret-cipher");

    env.CONNECTOR_ENCRYPTION_KEY = generateMasterKey();

    const context = await seedPlatformAdmin();

    // Initially no connector.
    const empty = await getPlatformEmailConnector(dbModule.db, context);
    expect(empty).toBeNull();

    // Create a Resend connector.
    const created = await upsertPlatformEmailConnector({
      db: dbModule.db,
      context,
      adapterKey: "resend",
      displayName: "Platform Resend",
      configuration: { fromAddress: "noreply@shopos.test", fromName: "ShopOS" },
      secret: { apiKey: "re_test_key_12345" },
    });
    expect(created.connectorId).toBeTruthy();

    // Read it back.
    const read = await getPlatformEmailConnector(dbModule.db, context);
    expect(read?.adapterKey).toBe("resend");
    expect(read?.hasSecret).toBe(true);
    expect(read?.status).toBe("active");
    // Secret is never exposed in the summary.
    expect(JSON.stringify(read)).not.toContain("re_test_key_12345");

    // Test it.
    const testResult = await testPlatformEmailConnector({ db: dbModule.db, context });
    expect(testResult.success).toBe(true);
  });

  it("creates an SMTP connector with encrypted credentials", async () => {
    const { upsertPlatformEmailConnector } = await import("@/modules/platform/connectors");
    const { generateMasterKey } = await import("@/modules/integrations/crypto/secret-cipher");

    env.CONNECTOR_ENCRYPTION_KEY = generateMasterKey();
    const context = await seedPlatformAdmin();

    await upsertPlatformEmailConnector({
      db: dbModule.db,
      context,
      adapterKey: "smtp",
      displayName: "Company SMTP",
      configuration: {
        host: "smtp.company.test",
        port: 587,
        secure: false,
        fromAddress: "it@company.test",
      },
      secret: { username: "smtpuser", password: "smtppass123" },
    });

    // Verify the raw secret in DB is encrypted (not plaintext).
    const raw = await dbModule.db.connectorInstance.findFirst({
      where: { capability: "email_delivery" },
      select: { encryptedSecret: true },
    });
    expect(raw?.encryptedSecret).toBeTruthy();
    expect(raw?.encryptedSecret).not.toContain("smtppass123");
    expect(raw?.encryptedSecret).not.toContain("smtpuser");
  });

  it("denies access without platform.connectors.manage permission", async () => {
    const { getPlatformEmailConnector } = await import("@/modules/platform/connectors");
    const { ConnectorOperationFailed } = await import("@/modules/platform/connectors");

    // Create a VIEWER operator.
    const viewerId = randomUUID();
    await dbModule.db.user.create({
      data: {
        id: viewerId,
        email: `v-${viewerId.slice(0, 8)}@e.test`,
        displayName: "Viewer",
        emailVerified: true,
        twoFactorEnabled: true,
      },
    });
    await dbModule.db.platformOperatorGrant.create({
      data: { id: randomUUID(), userId: viewerId, role: "VIEWER", reason: "Viewer grant." },
    });

    const { resolvePlatformContext, PlatformPermissionDenied } =
      await import("@/modules/platform/authorization");
    const viewerContext = await resolvePlatformContext({
      db: dbModule.db,
      actorId: viewerId,
      requestId: `test-${randomUUID()}`,
    });

    await expect(getPlatformEmailConnector(dbModule.db, viewerContext)).rejects.toThrowError(
      PlatformPermissionDenied,
    );
    expect(new ConnectorOperationFailed("invalid_adapter")).toBeInstanceOf(
      ConnectorOperationFailed,
    );
  });

  it("resolver falls back to console in test env when no connector exists", async () => {
    const {
      getCachedEmailDeliveryProvider,
      invalidateEmailDeliveryCache,
      refreshEmailDeliveryCache,
    } = await import("@/modules/integrations/email/email-delivery-resolver");

    invalidateEmailDeliveryCache();
    const provider = await refreshEmailDeliveryCache(dbModule.db);
    // In test env, falls back to console adapter.
    expect(provider.key).toBe("console");

    // Synchronous getter also returns console.
    expect(getCachedEmailDeliveryProvider().key).toBe("console");
  });

  it("rejects connector creation when encryption key is missing", async () => {
    const { upsertPlatformEmailConnector } = await import("@/modules/platform/connectors");
    const context = await seedPlatformAdmin();

    delete env.CONNECTOR_ENCRYPTION_KEY;

    await expect(
      upsertPlatformEmailConnector({
        db: dbModule.db,
        context,
        adapterKey: "resend",
        displayName: "No Key",
        configuration: { fromAddress: "noreply@test.test" },
        secret: { apiKey: "re_key" },
      }),
    ).rejects.toMatchObject({ reason: "encryption_key_missing" });
  });

  it("rejects an unknown adapter", async () => {
    const { upsertPlatformEmailConnector } = await import("@/modules/platform/connectors");
    const { generateMasterKey } = await import("@/modules/integrations/crypto/secret-cipher");

    env.CONNECTOR_ENCRYPTION_KEY = generateMasterKey();
    const context = await seedPlatformAdmin();

    await expect(
      upsertPlatformEmailConnector({
        db: dbModule.db,
        context,
        adapterKey: "nonexistent",
        displayName: "Bad Adapter",
        configuration: {},
        secret: {},
      }),
    ).rejects.toMatchObject({ reason: "invalid_adapter" });
  });
});
