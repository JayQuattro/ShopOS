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
  env.NODE_ENV = savedEnv.NODE_ENV ?? "test";
  env.CONNECTOR_ENCRYPTION_KEY = savedEnv.CONNECTOR_ENCRYPTION_KEY;
});

async function seedPlatformAdmin() {
  const adminId = randomUUID();
  await dbModule.db.user.create({
    data: {
      id: adminId,
      email: `vinid-${adminId.slice(0, 8)}@example.test`,
      displayName: "Vehicle ID Admin",
      emailVerified: true,
      twoFactorEnabled: true,
    },
  });
  await dbModule.db.platformOperatorGrant.create({
    data: {
      id: randomUUID(),
      userId: adminId,
      role: "ADMIN",
      reason: "Vehicle identification connector test grant.",
    },
  });

  const { resolvePlatformContext } = await import("@/modules/platform/authorization");
  return resolvePlatformContext({
    db: dbModule.db,
    actorId: adminId,
    requestId: `test-${randomUUID()}`,
  });
}

describe("platform vehicle identification connector management", { skip: shouldSkip }, () => {
  it("creates, reads, and rotates a platform connector with an audit event", async () => {
    const { getPlatformVehicleIdConnector, upsertPlatformVehicleIdConnector } =
      await import("@/modules/integrations/vehicle-id/vehicle-id-connector-service");
    const { generateMasterKey } = await import("@/modules/integrations/crypto/secret-cipher");

    env.CONNECTOR_ENCRYPTION_KEY = generateMasterKey();
    const context = await seedPlatformAdmin();

    const empty = await getPlatformVehicleIdConnector(dbModule.db, context);
    expect(empty).toBeNull();

    const created = await upsertPlatformVehicleIdConnector({
      db: dbModule.db,
      context,
      adapterKey: "nhtsa-vpic",
      displayName: "Platform vPIC",
      configuration: {},
      secret: {},
    });
    expect(created.connectorId).toBeTruthy();

    const read = await getPlatformVehicleIdConnector(dbModule.db, context);
    expect(read?.adapterKey).toBe("nhtsa-vpic");
    expect(read?.status).toBe("active");

    // Rotating to "disabled" deactivates the previous active connector.
    const rotated = await upsertPlatformVehicleIdConnector({
      db: dbModule.db,
      context,
      adapterKey: "disabled",
      displayName: "Decoding off",
      configuration: {},
      secret: {},
    });
    expect(rotated.connectorId).not.toBe(created.connectorId);

    const statuses = await dbModule.db.connectorInstance.findMany({
      where: { capability: "vehicle_identification" },
      select: { id: true, status: true },
    });
    expect(statuses.find((c) => c.id === created.connectorId)?.status).toBe("disabled");
    expect(statuses.find((c) => c.id === rotated.connectorId)?.status).toBe("active");

    const audit = await dbModule.db.platformAuditEvent.findFirst({
      where: { action: "platform.connector.vehicle_id_configured", targetId: rotated.connectorId },
    });
    expect(audit).not.toBeNull();
  });

  it("denies connector reads without platform.connectors.manage permission", async () => {
    const { getPlatformVehicleIdConnector } =
      await import("@/modules/integrations/vehicle-id/vehicle-id-connector-service");
    const { generateMasterKey } = await import("@/modules/integrations/crypto/secret-cipher");

    env.CONNECTOR_ENCRYPTION_KEY = generateMasterKey();

    const viewerId = randomUUID();
    await dbModule.db.user.create({
      data: {
        id: viewerId,
        email: `v-${viewerId.slice(0, 8)}@vinid.test`,
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

    await expect(getPlatformVehicleIdConnector(dbModule.db, viewerContext)).rejects.toThrowError(
      PlatformPermissionDenied,
    );
  });

  it("rejects unknown adapters and a missing encryption key", async () => {
    const { upsertPlatformVehicleIdConnector } =
      await import("@/modules/integrations/vehicle-id/vehicle-id-connector-service");
    const { generateMasterKey } = await import("@/modules/integrations/crypto/secret-cipher");

    env.CONNECTOR_ENCRYPTION_KEY = generateMasterKey();
    const context = await seedPlatformAdmin();

    await expect(
      upsertPlatformVehicleIdConnector({
        db: dbModule.db,
        context,
        adapterKey: "carfax",
        displayName: "Not Registered",
        configuration: {},
        secret: {},
      }),
    ).rejects.toMatchObject({ reason: "invalid_adapter" });

    delete env.CONNECTOR_ENCRYPTION_KEY;
    await expect(
      upsertPlatformVehicleIdConnector({
        db: dbModule.db,
        context,
        adapterKey: "nhtsa-vpic",
        displayName: "No Key",
        configuration: {},
        secret: {},
      }),
    ).rejects.toMatchObject({ reason: "encryption_key_missing" });
  });
});

describe("vehicle identification adapter resolution", { skip: shouldSkip }, () => {
  it("prefers the org connector, honors disabled, and falls back to the keyless default", async () => {
    const { resolveVehicleIdAdapter } =
      await import("@/modules/integrations/vehicle-id/vehicle-id-connector-service");
    const { NhtsaVpicAdapter } =
      await import("@/modules/integrations/vehicle-id/vehicle-id-adapters");
    const { generateMasterKey, encryptSecret } =
      await import("@/modules/integrations/crypto/secret-cipher");

    const masterKeyB64 = generateMasterKey();
    env.CONNECTOR_ENCRYPTION_KEY = masterKeyB64;
    const masterKey = Buffer.from(masterKeyB64, "base64");
    env.NODE_ENV = "production";

    const orgAId = randomUUID();
    await dbModule.db.organization.create({
      data: { id: orgAId, name: "Org A", slug: `org-a-${orgAId.slice(0, 8)}` },
    });

    // No connector anywhere: production still resolves the keyless default.
    const fallback = await resolveVehicleIdAdapter(dbModule.db, orgAId);
    expect(fallback).toBeInstanceOf(NhtsaVpicAdapter);

    // Platform-scoped explicit choice behaves identically.
    await dbModule.db.connectorInstance.create({
      data: {
        id: randomUUID(),
        scope: "platform",
        capability: "vehicle_identification",
        adapterKey: "nhtsa-vpic",
        displayName: "Platform vPIC",
        configuration: {},
        encryptedSecret: encryptSecret(JSON.stringify({}), masterKey),
      },
    });
    expect(await resolveVehicleIdAdapter(dbModule.db, orgAId)).toBeInstanceOf(NhtsaVpicAdapter);

    // An org-scoped "disabled" connector wins over the platform one → null.
    await dbModule.db.connectorInstance.create({
      data: {
        id: randomUUID(),
        organizationId: orgAId,
        scope: "organization",
        capability: "vehicle_identification",
        adapterKey: "disabled",
        displayName: "Org A Off",
        configuration: {},
        encryptedSecret: encryptSecret(JSON.stringify({}), masterKey),
      },
    });
    expect(await resolveVehicleIdAdapter(dbModule.db, orgAId)).toBeNull();
  });

  it("falls back to the keyless default when a connector secret cannot be decrypted", async () => {
    const { resolveVehicleIdAdapter } =
      await import("@/modules/integrations/vehicle-id/vehicle-id-connector-service");
    const { NhtsaVpicAdapter } =
      await import("@/modules/integrations/vehicle-id/vehicle-id-adapters");
    const { generateMasterKey, encryptSecret } =
      await import("@/modules/integrations/crypto/secret-cipher");

    env.CONNECTOR_ENCRYPTION_KEY = generateMasterKey();
    env.NODE_ENV = "production";

    const orgId = randomUUID();
    await dbModule.db.organization.create({
      data: { id: orgId, name: "Prod Org", slug: `prod-org-${orgId.slice(0, 8)}` },
    });

    // Encrypted under a different master key: unreadable, but decoding stays up.
    await dbModule.db.connectorInstance.create({
      data: {
        id: randomUUID(),
        scope: "platform",
        capability: "vehicle_identification",
        adapterKey: "nhtsa-vpic",
        displayName: "Unreadable",
        configuration: {},
        encryptedSecret: encryptSecret(
          JSON.stringify({}),
          Buffer.from(generateMasterKey(), "base64"),
        ),
      },
    });
    expect(await resolveVehicleIdAdapter(dbModule.db, orgId)).toBeInstanceOf(NhtsaVpicAdapter);
  });

  it("always resolves the console adapter in the test environment", async () => {
    const { resolveVehicleIdAdapter } =
      await import("@/modules/integrations/vehicle-id/vehicle-id-connector-service");

    env.NODE_ENV = "test";
    const adapter = await resolveVehicleIdAdapter(dbModule.db, randomUUID());
    expect(adapter?.key).toBe("console");
  });
});
