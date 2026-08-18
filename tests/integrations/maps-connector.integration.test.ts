import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

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
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }
  await resetTestDatabase(dbModule.db);
  await dbModule.db.$disconnect();
});

beforeEach(async () => {
  if (!RUN) return;
  if (!("CONNECTOR_ENCRYPTION_KEY" in savedEnv)) {
    savedEnv.CONNECTOR_ENCRYPTION_KEY = env.CONNECTOR_ENCRYPTION_KEY;
  }
  if (!("NODE_ENV" in savedEnv)) {
    savedEnv.NODE_ENV = env.NODE_ENV;
  }
  await resetTestDatabase(dbModule.db);
});

afterEach(() => {
  // Resolver tests flip NODE_ENV to reach the DB-backed resolution path.
  env.NODE_ENV = savedEnv.NODE_ENV ?? "test";
  env.CONNECTOR_ENCRYPTION_KEY = savedEnv.CONNECTOR_ENCRYPTION_KEY;
});

async function seedPlatformAdmin() {
  const adminId = randomUUID();
  await dbModule.db.user.create({
    data: {
      id: adminId,
      email: `maps-${adminId.slice(0, 8)}@example.test`,
      displayName: "Maps Admin",
      emailVerified: true,
      twoFactorEnabled: true,
    },
  });
  await dbModule.db.platformOperatorGrant.create({
    data: {
      id: randomUUID(),
      userId: adminId,
      role: "ADMIN",
      reason: "Maps connector test grant.",
    },
  });

  const { resolvePlatformContext } = await import("@/modules/platform/authorization");
  return resolvePlatformContext({
    db: dbModule.db,
    actorId: adminId,
    requestId: `test-${randomUUID()}`,
  });
}

describe("platform maps connector management", { skip: shouldSkip }, () => {
  it("creates, reads, and rotates a platform maps connector with an audit event", async () => {
    const { getPlatformMapsConnector, upsertPlatformMapsConnector } =
      await import("@/modules/integrations/maps/maps-connector-service");
    const { generateMasterKey } = await import("@/modules/integrations/crypto/secret-cipher");

    env.CONNECTOR_ENCRYPTION_KEY = generateMasterKey();
    const context = await seedPlatformAdmin();

    const empty = await getPlatformMapsConnector(dbModule.db, context);
    expect(empty).toBeNull();

    const created = await upsertPlatformMapsConnector({
      db: dbModule.db,
      context,
      adapterKey: "google",
      displayName: "Platform Google Maps",
      configuration: {},
      secret: { apiKey: "gm_test_key_12345" },
    });
    expect(created.connectorId).toBeTruthy();

    const read = await getPlatformMapsConnector(dbModule.db, context);
    expect(read?.adapterKey).toBe("google");
    expect(read?.displayName).toBe("Platform Google Maps");
    expect(read?.status).toBe("active");
    expect(JSON.stringify(read)).not.toContain("gm_test_key_12345");

    const raw = await dbModule.db.connectorInstance.findFirst({
      where: { capability: "maps" },
      select: { encryptedSecret: true },
    });
    expect(raw?.encryptedSecret).toBeTruthy();
    expect(raw?.encryptedSecret).not.toContain("gm_test_key_12345");

    // Rotating to another provider disables the previous active connector.
    const rotated = await upsertPlatformMapsConnector({
      db: dbModule.db,
      context,
      adapterKey: "mapbox",
      displayName: "Platform Mapbox",
      configuration: {},
      secret: { accessToken: "pk.test.token" },
    });
    expect(rotated.connectorId).not.toBe(created.connectorId);

    const statuses = await dbModule.db.connectorInstance.findMany({
      where: { capability: "maps" },
      select: { id: true, status: true },
    });
    expect(statuses.find((c) => c.id === created.connectorId)?.status).toBe("disabled");
    expect(statuses.find((c) => c.id === rotated.connectorId)?.status).toBe("active");

    const audit = await dbModule.db.platformAuditEvent.findFirst({
      where: { action: "platform.connector.maps_configured", targetId: rotated.connectorId },
    });
    expect(audit).not.toBeNull();
  });

  it("denies connector reads without platform.connectors.manage permission", async () => {
    const { getPlatformMapsConnector } =
      await import("@/modules/integrations/maps/maps-connector-service");
    const { generateMasterKey } = await import("@/modules/integrations/crypto/secret-cipher");

    env.CONNECTOR_ENCRYPTION_KEY = generateMasterKey();

    const viewerId = randomUUID();
    await dbModule.db.user.create({
      data: {
        id: viewerId,
        email: `v-${viewerId.slice(0, 8)}@maps.test`,
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

    await expect(getPlatformMapsConnector(dbModule.db, viewerContext)).rejects.toThrowError(
      PlatformPermissionDenied,
    );
  });

  it("rejects unknown adapters and missing required aws configuration", async () => {
    const { upsertPlatformMapsConnector } =
      await import("@/modules/integrations/maps/maps-connector-service");
    const { generateMasterKey } = await import("@/modules/integrations/crypto/secret-cipher");

    env.CONNECTOR_ENCRYPTION_KEY = generateMasterKey();
    const context = await seedPlatformAdmin();

    await expect(
      upsertPlatformMapsConnector({
        db: dbModule.db,
        context,
        adapterKey: "nonexistent",
        displayName: "Bad Adapter",
        configuration: {},
        secret: {},
      }),
    ).rejects.toMatchObject({ reason: "invalid_adapter" });

    await expect(
      upsertPlatformMapsConnector({
        db: dbModule.db,
        context,
        adapterKey: "aws",
        displayName: "Incomplete AWS",
        configuration: { region: "us-east-1" },
        secret: { accessKeyId: "ak", secretAccessKey: "sk" },
      }),
    ).rejects.toMatchObject({ reason: "invalid_configuration" });
  });

  it("rejects connector creation when the encryption key is missing", async () => {
    const { upsertPlatformMapsConnector } =
      await import("@/modules/integrations/maps/maps-connector-service");

    delete env.CONNECTOR_ENCRYPTION_KEY;
    const context = await seedPlatformAdmin();

    await expect(
      upsertPlatformMapsConnector({
        db: dbModule.db,
        context,
        adapterKey: "google",
        displayName: "No Key",
        configuration: {},
        secret: { apiKey: "gm_key" },
      }),
    ).rejects.toMatchObject({ reason: "encryption_key_missing" });
  });
});

describe("maps adapter resolution", { skip: shouldSkip }, () => {
  it("prefers the org connector, falls back to platform, then console in development", async () => {
    const { resolveMapsAdapter } =
      await import("@/modules/integrations/maps/maps-connector-service");
    const { GoogleMapsAdapter, MapboxAdapter, getConsoleMapsAdapter } =
      await import("@/modules/integrations/maps/maps-adapters");
    const { generateMasterKey, encryptSecret } =
      await import("@/modules/integrations/crypto/secret-cipher");

    const masterKeyB64 = generateMasterKey();
    env.CONNECTOR_ENCRYPTION_KEY = masterKeyB64;
    const masterKey = Buffer.from(masterKeyB64, "base64");
    env.NODE_ENV = "development";

    const orgAId = randomUUID();
    await dbModule.db.organization.create({
      data: { id: orgAId, name: "Org A", slug: `org-a-${orgAId.slice(0, 8)}` },
    });

    // Platform connector only: every org resolves through it.
    await dbModule.db.connectorInstance.create({
      data: {
        id: randomUUID(),
        scope: "platform",
        capability: "maps",
        adapterKey: "google",
        displayName: "Platform Google",
        configuration: {},
        encryptedSecret: encryptSecret(JSON.stringify({ apiKey: "gm_key" }), masterKey),
      },
    });
    const viaPlatform = await resolveMapsAdapter(dbModule.db, orgAId);
    expect(viaPlatform).toBeInstanceOf(GoogleMapsAdapter);

    // An org-scoped connector wins over the platform one.
    await dbModule.db.connectorInstance.create({
      data: {
        id: randomUUID(),
        organizationId: orgAId,
        scope: "organization",
        capability: "maps",
        adapterKey: "mapbox",
        displayName: "Org A Mapbox",
        configuration: {},
        encryptedSecret: encryptSecret(JSON.stringify({ accessToken: "pk.token" }), masterKey),
      },
    });
    const viaOrg = await resolveMapsAdapter(dbModule.db, orgAId);
    expect(viaOrg).toBeInstanceOf(MapboxAdapter);

    // No connector anywhere: development falls back to the console adapter.
    await dbModule.db.connectorInstance.deleteMany({ where: { capability: "maps" } });
    const fallback = await resolveMapsAdapter(dbModule.db, orgAId);
    expect(fallback).toBe(getConsoleMapsAdapter());
  });

  it("returns null in production when no connector exists and when decryption fails", async () => {
    const { resolveMapsAdapter } =
      await import("@/modules/integrations/maps/maps-connector-service");
    const { generateMasterKey, encryptSecret } =
      await import("@/modules/integrations/crypto/secret-cipher");

    const masterKey = Buffer.from(generateMasterKey(), "base64");
    env.CONNECTOR_ENCRYPTION_KEY = masterKey.toString("base64");
    env.NODE_ENV = "production";

    const orgId = randomUUID();
    await dbModule.db.organization.create({
      data: { id: orgId, name: "Prod Org", slug: `prod-org-${orgId.slice(0, 8)}` },
    });

    expect(await resolveMapsAdapter(dbModule.db, orgId)).toBeNull();

    // A connector encrypted under a different master key cannot be decrypted → null.
    await dbModule.db.connectorInstance.create({
      data: {
        id: randomUUID(),
        scope: "platform",
        capability: "maps",
        adapterKey: "google",
        displayName: "Unreadable",
        configuration: {},
        encryptedSecret: encryptSecret(
          JSON.stringify({ apiKey: "gm_key" }),
          Buffer.from(generateMasterKey(), "base64"),
        ),
      },
    });
    expect(await resolveMapsAdapter(dbModule.db, orgId)).toBeNull();
  });

  it("always resolves the console adapter in the test environment", async () => {
    const { resolveMapsAdapter } =
      await import("@/modules/integrations/maps/maps-connector-service");

    env.NODE_ENV = "test";
    const adapter = await resolveMapsAdapter(dbModule.db, randomUUID());
    expect(adapter?.key).toBe("console");
  });
});
