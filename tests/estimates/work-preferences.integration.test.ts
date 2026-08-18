async function seedWorkOrder() {
  const orgId = randomUUID();
  const locationId = randomUUID();
  const userId = randomUUID();
  const membershipId = randomUUID();
  const roleId = randomUUID();
  const customerId = randomUUID();

  await dbModule.db.$transaction([
    dbModule.db.organization.create({
      data: { id: orgId, slug: `org-${orgId.slice(0, 8)}`, name: "Prefs WO Org" },
    }),
    dbModule.db.location.create({
      data: { id: locationId, organizationId: orgId, code: "MAIN", name: "Main", timeZone: "UTC" },
    }),
    dbModule.db.user.create({
      data: {
        id: userId,
        email: `w-${userId.slice(0, 8)}@example.test`,
        displayName: "Prefs WO User",
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
        key: "owner",
        name: "Owner",
        permissions: [
          "work_orders.read",
          "work_orders.write",
          "estimates.present",
          "organizations.manage",
        ],
      },
    }),
    dbModule.db.membershipRole.create({ data: { organizationId: orgId, membershipId, roleId } }),
    dbModule.db.customer.create({
      data: {
        id: customerId,
        organizationId: orgId,
        kind: "INDIVIDUAL",
        displayName: "Prefs WO Customer",
      },
    }),
    dbModule.db.workOrder.create({
      data: {
        organizationId: orgId,
        locationId,
        customerId,
        number: "RO-9999",
        customerConcern: "seeding",
      },
    }),
  ]);

  const workOrderId = (await dbModule.db.workOrder.findFirst({ where: { organizationId: orgId } }))!
    .id;

  return {
    customerId,
    locationId,
    workOrderId,
    context: () =>
      ({
        actorId: userId,
        organizationId: orgId,
        membershipId,
        requestId: randomUUID(),
        organizationWideLocationAccess: true,
        allowedLocationIds: new Set<string>(),
        permissions: new Set([
          "work_orders.read",
          "work_orders.write",
          "estimates.present",
          "organizations.manage",
        ] as const),
      }) as import("@/modules/tenancy/policy").TenantContext,
  };
}

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

beforeEach(async () => {
  if (!RUN) return;
  await resetTestDatabase(dbModule.db);
});

async function seedOrgWithManager(permission: "organizations.manage" | "work_orders.read") {
  const orgId = randomUUID();
  const userId = randomUUID();
  const membershipId = randomUUID();
  const roleId = randomUUID();

  await dbModule.db.$transaction([
    dbModule.db.organization.create({
      data: { id: orgId, slug: `org-${orgId.slice(0, 8)}`, name: "Prefs Org" },
    }),
    dbModule.db.user.create({
      data: {
        id: userId,
        email: `u-${userId.slice(0, 8)}@example.test`,
        displayName: "Prefs User",
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
        key: "custom",
        name: "Custom",
        permissions: [permission],
      },
    }),
    dbModule.db.membershipRole.create({ data: { organizationId: orgId, membershipId, roleId } }),
  ]);

  return () =>
    ({
      actorId: userId,
      organizationId: orgId,
      membershipId,
      requestId: randomUUID(),
      organizationWideLocationAccess: true,
      allowedLocationIds: new Set<string>(),
      permissions: new Set([permission] as const),
    }) as import("@/modules/tenancy/policy").TenantContext;
}

describe("work preferences (#130)", { skip: shouldSkip }, () => {
  it("reads the organization defaults", async () => {
    const { getWorkPreferences } = await import("@/modules/estimates/work-preferences-service");
    const context = await seedOrgWithManager("organizations.manage");
    const preferences = await getWorkPreferences(dbModule.db, context());
    expect(preferences).toEqual({
      changeOrderCreditPolicy: "AUTO_APPLY",
      invoiceLinePolicy: "APPROVED_ONLY",
      defaultPaperSize: "LETTER",
      qualityCheckRequired: true,
      authorizationLinkTtlHours: 72,
      workOrderNumberPrefix: "RO-",
      invoiceNumberPrefix: "INV-",
      defaultLaborRateMinor: 0,
      defaultTaxRateBasisPoints: 0,
    });
  });

  it("updates both policies and records an audit event", async () => {
    const { getWorkPreferences, updateWorkPreferences } =
      await import("@/modules/estimates/work-preferences-service");
    const context = await seedOrgWithManager("organizations.manage");
    await updateWorkPreferences(dbModule.db, context(), {
      changeOrderCreditPolicy: "REQUIRE_APPROVAL",
      invoiceLinePolicy: "ALL_LINES",
      defaultPaperSize: "A4",
      qualityCheckRequired: false,
      authorizationLinkTtlHours: 48,
      workOrderNumberPrefix: "WO-",
      invoiceNumberPrefix: "IN-",
      defaultLaborRateMinor: 14500,
      defaultTaxRateBasisPoints: 720,
    });

    const preferences = await getWorkPreferences(dbModule.db, context());
    expect(preferences).toEqual({
      changeOrderCreditPolicy: "REQUIRE_APPROVAL",
      invoiceLinePolicy: "ALL_LINES",
      defaultPaperSize: "A4",
      qualityCheckRequired: false,
      authorizationLinkTtlHours: 48,
      workOrderNumberPrefix: "WO-",
      invoiceNumberPrefix: "IN-",
      defaultLaborRateMinor: 14500,
      defaultTaxRateBasisPoints: 720,
    });

    const audit = await dbModule.db.auditEvent.findFirst({
      where: { action: "organization.work_preferences_updated" },
    });
    expect(audit?.after).toMatchObject({
      changeOrderCreditPolicy: "REQUIRE_APPROVAL",
      invoiceLinePolicy: "ALL_LINES",
    });
  });

  it("denies reads and writes without organizations.manage", async () => {
    const { getWorkPreferences, updateWorkPreferences } =
      await import("@/modules/estimates/work-preferences-service");
    const context = await seedOrgWithManager("work_orders.read");
    await expect(getWorkPreferences(dbModule.db, context())).rejects.toThrow();
    await expect(
      updateWorkPreferences(dbModule.db, context(), {
        changeOrderCreditPolicy: "REQUIRE_APPROVAL",
        invoiceLinePolicy: "ALL_LINES",
        defaultPaperSize: "LEGAL",
        qualityCheckRequired: true,
        authorizationLinkTtlHours: 72,
        workOrderNumberPrefix: "RO-",
        invoiceNumberPrefix: "INV-",
        defaultLaborRateMinor: 0,
        defaultTaxRateBasisPoints: 0,
      }),
    ).rejects.toThrow();
  });
});

describe("work preferences gate effects (#163)", { skip: shouldSkip }, () => {
  it("authorization links honor the configured TTL", async () => {
    const { updateWorkPreferences } = await import("@/modules/estimates/work-preferences-service");
    const { createDraftRevision, presentRevision } =
      await import("@/modules/estimates/estimate-service");
    const seedData = await seedWorkOrder();
    const context = seedData.context();

    await updateWorkPreferences(dbModule.db, context, {
      changeOrderCreditPolicy: "AUTO_APPLY",
      invoiceLinePolicy: "APPROVED_ONLY",
      defaultPaperSize: "LETTER",
      qualityCheckRequired: true,
      authorizationLinkTtlHours: 48,
      workOrderNumberPrefix: "RO-",
      invoiceNumberPrefix: "INV-",
      defaultLaborRateMinor: 0,
      defaultTaxRateBasisPoints: 0,
    });

    const { revisionId } = await createDraftRevision({
      db: dbModule.db,
      context,
      workOrderId: seedData.workOrderId,
      currency: "USD",
    });
    await presentRevision({ db: dbModule.db, context, revisionId });

    const link = await dbModule.db.authorizationLink.findFirst({
      where: { estimateRevisionId: revisionId },
    });
    expect(link).not.toBeNull();
    const hours = (link!.expiresAt.getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(47.9);
    expect(hours).toBeLessThan(48.1);
  });

  it("work orders and invoices use the configured prefixes", async () => {
    const { updateWorkPreferences } = await import("@/modules/estimates/work-preferences-service");
    const { WorkOrderRepository } = await import("@/modules/work-orders/work-order-repository");
    const seedData = await seedWorkOrder();
    const context = seedData.context();

    await updateWorkPreferences(dbModule.db, context, {
      changeOrderCreditPolicy: "AUTO_APPLY",
      invoiceLinePolicy: "APPROVED_ONLY",
      defaultPaperSize: "LETTER",
      qualityCheckRequired: true,
      authorizationLinkTtlHours: 72,
      workOrderNumberPrefix: "JOB-",
      invoiceNumberPrefix: "BILL-",
      defaultLaborRateMinor: 0,
      defaultTaxRateBasisPoints: 0,
    });

    const repository = new WorkOrderRepository({ db: dbModule.db, context });
    const created = await repository.create({
      customerId: seedData.customerId,
      locationId: seedData.locationId,
      customerConcern: "Prefix test",
    });
    expect(created.number).toMatch(/^JOB-\d+$/);
  });
});
