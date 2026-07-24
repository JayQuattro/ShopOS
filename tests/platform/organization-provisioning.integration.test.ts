import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { provisionOrganization } from "@/modules/organizations/provision-organization";
import {
  PlatformContextNotResolved,
  PlatformPermissionDenied,
  resolvePlatformContext,
} from "@/modules/platform/authorization";
import { changeOrganizationStatus } from "@/modules/platform/organizations";

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

afterAll(async () => {
  if (!RUN) return;
  await resetTestDatabase(dbModule.db);
  await dbModule.db.$disconnect();
});

describe.skipIf(shouldSkip)("organization provisioning", () => {
  it("creates the entire first-tenant graph atomically and replays idempotently", async () => {
    const userId = randomUUID();
    await dbModule.db.user.create({
      data: {
        id: userId,
        email: `founder-${userId}@example.test`,
        displayName: "Founding Owner",
        emailVerified: true,
      },
    });

    const input = {
      db: dbModule.db,
      actor: {
        kind: "self-service" as const,
        userId,
        requestId: `request-${randomUUID()}`,
      },
      idempotencyKey: `onboarding-${randomUUID()}`,
      organization: {
        name: "Northline Service",
        slug: `northline-${userId.slice(0, 8)}`,
        defaultCurrency: "usd",
      },
      firstLocation: {
        name: "Main Shop",
        code: "main",
        timeZone: "America/New_York",
      },
    };

    const created = await provisionOrganization(input);
    const replayed = await provisionOrganization(input);

    expect(replayed).toMatchObject({
      organizationId: created.organizationId,
      locationId: created.locationId,
      membershipId: created.membershipId,
      replayed: true,
    });

    const organization = await dbModule.db.organization.findUniqueOrThrow({
      where: { id: created.organizationId },
      include: {
        locations: true,
        roles: true,
        memberships: { include: { roles: { include: { role: true } } } },
        auditEvents: true,
        platformAuditEvents: true,
        outboxEvents: true,
        provisioningRequest: true,
      },
    });

    expect(organization.status).toBe("ACTIVE");
    expect(organization.subscriptionState).toBe("UNMANAGED");
    expect(organization.locations).toHaveLength(1);
    expect(organization.locations[0]?.code).toBe("MAIN");
    expect(organization.roles).toHaveLength(6);
    expect(organization.memberships).toHaveLength(1);
    expect(organization.memberships[0]).toMatchObject({
      userId,
      authRole: "owner",
      organizationWideLocationAccess: true,
    });
    expect(organization.memberships[0]?.roles[0]?.role.key).toBe("owner");
    expect(organization.auditEvents.map((event) => event.action)).toContain(
      "organization.provisioned",
    );
    expect(organization.platformAuditEvents.map((event) => event.action)).toContain(
      "organization.provisioned",
    );
    expect(organization.outboxEvents.map((event) => event.eventType)).toContain(
      "organization.provisioned",
    );
    expect(organization.provisioningRequest?.actorKind).toBe("SELF_SERVICE");
  });

  it("rejects idempotency-key reuse with different input and a second self-service tenant", async () => {
    const userId = randomUUID();
    await dbModule.db.user.create({
      data: {
        id: userId,
        email: `idempotency-${userId}@example.test`,
        displayName: "Idempotency Tester",
        emailVerified: true,
      },
    });
    const idempotencyKey = `onboarding-${randomUUID()}`;
    const baseInput = {
      db: dbModule.db,
      actor: {
        kind: "self-service" as const,
        userId,
        requestId: `request-${randomUUID()}`,
      },
      idempotencyKey,
      organization: {
        name: "Stable Input Shop",
        slug: `stable-${userId.slice(0, 8)}`,
        defaultCurrency: "USD",
      },
      firstLocation: {
        name: "Main Shop",
        code: "MAIN",
        timeZone: "America/New_York",
      },
    };
    await provisionOrganization(baseInput);

    await expect(
      provisionOrganization({
        ...baseInput,
        firstLocation: { ...baseInput.firstLocation, name: "Changed Location" },
      }),
    ).rejects.toMatchObject({
      reason: "idempotency_conflict",
    });

    await expect(
      provisionOrganization({
        ...baseInput,
        idempotencyKey: `second-${randomUUID()}`,
        organization: {
          ...baseInput.organization,
          slug: `second-${userId.slice(0, 8)}`,
        },
      }),
    ).rejects.toMatchObject({
      reason: "self_service_limit_reached",
    });
  });

  it("keeps platform authority separate while allowing audited provisioning and suspension", async () => {
    const operatorId = randomUUID();
    const founderId = randomUUID();
    await dbModule.db.user.createMany({
      data: [
        {
          id: operatorId,
          email: `operator-${operatorId}@example.test`,
          displayName: "Platform Operator",
          emailVerified: true,
          twoFactorEnabled: true,
        },
        {
          id: founderId,
          email: `customer-${founderId}@example.test`,
          displayName: "Customer Founder",
          emailVerified: true,
        },
      ],
    });
    await dbModule.db.platformOperatorGrant.create({
      data: {
        id: randomUUID(),
        userId: operatorId,
        role: "ADMIN",
        reason: "Integration test platform authorization.",
      },
    });
    const context = await resolvePlatformContext({
      db: dbModule.db,
      actorId: operatorId,
      requestId: `request-${randomUUID()}`,
    });

    const created = await provisionOrganization({
      db: dbModule.db,
      actor: {
        kind: "platform",
        context,
        foundingUserId: founderId,
      },
      idempotencyKey: `platform-${randomUUID()}`,
      organization: {
        name: "Provisioned Customer",
        slug: `provisioned-${founderId.slice(0, 8)}`,
        defaultCurrency: "USD",
      },
      firstLocation: {
        name: "Customer Main",
        code: "MAIN",
        timeZone: "America/Chicago",
      },
    });

    expect(
      await dbModule.db.organizationMembership.count({
        where: { organizationId: created.organizationId, userId: operatorId },
      }),
    ).toBe(0);
    expect(
      await dbModule.db.organizationMembership.count({
        where: { organizationId: created.organizationId, userId: founderId },
      }),
    ).toBe(1);

    await changeOrganizationStatus({
      db: dbModule.db,
      context,
      organizationId: created.organizationId,
      targetStatus: "SUSPENDED",
      reason: "Customer requested a temporary account suspension.",
    });

    const suspended = await dbModule.db.organization.findUniqueOrThrow({
      where: { id: created.organizationId },
      include: { platformAuditEvents: true, outboxEvents: true },
    });
    expect(suspended.status).toBe("SUSPENDED");
    expect(suspended.platformAuditEvents.map((event) => event.action)).toContain(
      "organization.suspended",
    );
    expect(suspended.outboxEvents.map((event) => event.eventType)).toContain(
      "organization.suspended",
    );
  });

  it("denies provisioning to a read-only platform operator", async () => {
    const operatorId = randomUUID();
    const founderId = randomUUID();
    await dbModule.db.user.createMany({
      data: [
        {
          id: operatorId,
          email: `viewer-${operatorId}@example.test`,
          displayName: "Platform Viewer",
          emailVerified: true,
          twoFactorEnabled: true,
        },
        {
          id: founderId,
          email: `viewer-founder-${founderId}@example.test`,
          displayName: "Viewer Founder",
          emailVerified: true,
        },
      ],
    });
    await dbModule.db.platformOperatorGrant.create({
      data: {
        id: randomUUID(),
        userId: operatorId,
        role: "VIEWER",
        reason: "Integration test read-only platform access.",
      },
    });
    const context = await resolvePlatformContext({
      db: dbModule.db,
      actorId: operatorId,
      requestId: `request-${randomUUID()}`,
    });

    await expect(
      provisionOrganization({
        db: dbModule.db,
        actor: {
          kind: "platform",
          context,
          foundingUserId: founderId,
        },
        idempotencyKey: `denied-${randomUUID()}`,
        organization: {
          name: "Denied Organization",
          slug: `denied-${founderId.slice(0, 8)}`,
          defaultCurrency: "USD",
        },
        firstLocation: {
          name: "Denied Location",
          code: "MAIN",
          timeZone: "UTC",
        },
      }),
    ).rejects.toBeInstanceOf(PlatformPermissionDenied);
  });

  it("denies the control plane when the operator has not enabled two-factor authentication", async () => {
    const operatorId = randomUUID();
    await dbModule.db.user.create({
      data: {
        id: operatorId,
        email: `no-mfa-${operatorId}@example.test`,
        displayName: "Unenrolled Operator",
        emailVerified: true,
        twoFactorEnabled: false,
      },
    });
    await dbModule.db.platformOperatorGrant.create({
      data: {
        id: randomUUID(),
        userId: operatorId,
        role: "ADMIN",
        reason: "Integration test MFA denial path.",
      },
    });

    await expect(
      resolvePlatformContext({
        db: dbModule.db,
        actorId: operatorId,
        requestId: `request-${randomUUID()}`,
      }),
    ).rejects.toMatchObject({
      name: PlatformContextNotResolved.name,
      reason: "mfa_required",
    });
  });
});
