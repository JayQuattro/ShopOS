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

async function seedShop() {
  const orgId = randomUUID();
  const locationId = randomUUID();
  const userId = randomUUID();
  const membershipId = randomUUID();
  const roleId = randomUUID();
  const customerId = randomUUID();
  const assetId = randomUUID();
  const workOrderId = randomUUID();
  const baselineId = randomUUID();

  await dbModule.db.$transaction([
    dbModule.db.organization.create({
      data: {
        id: orgId,
        slug: `org-${orgId.slice(0, 8)}`,
        name: "Rates Org",
        defaultLaborRateMinor: 14500n,
        defaultTaxRateBasisPoints: 720,
      },
    }),
    dbModule.db.location.create({
      data: { id: locationId, organizationId: orgId, code: "MAIN", name: "Main", timeZone: "UTC" },
    }),
    dbModule.db.user.create({
      data: {
        id: userId,
        email: `r-${userId.slice(0, 8)}@example.test`,
        displayName: "Rates User",
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
          "assets.read",
          "assets.write",
          "estimates.present",
        ],
      },
    }),
    dbModule.db.membershipRole.create({ data: { organizationId: orgId, membershipId, roleId } }),
    dbModule.db.customer.create({
      data: {
        id: customerId,
        organizationId: orgId,
        kind: "INDIVIDUAL",
        displayName: "Rates Customer",
      },
    }),
    dbModule.db.asset.create({
      data: {
        id: assetId,
        organizationId: orgId,
        customerId,
        displayName: "Rates Car",
        category: "automobile",
      },
    }),
    dbModule.db.workOrder.create({
      data: {
        id: workOrderId,
        organizationId: orgId,
        locationId,
        customerId,
        assetId,
        number: "RO-1801",
        customerConcern: "Rates",
        status: "ESTIMATING",
      },
    }),
    dbModule.db.estimateRevision.create({
      data: {
        id: baselineId,
        organizationId: orgId,
        locationId,
        workOrderId,
        revisionNumber: 1,
        status: "PRESENTED",
        documentKind: "BASELINE",
        currency: "USD",
        subtotalMinor: 10000n,
        discountMinor: 0n,
        taxMinor: 0n,
        totalMinor: 10000n,
        presentedAt: new Date(),
      },
    }),
  ]);

  return {
    orgId,
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
          "assets.read",
          "assets.write",
          "estimates.present",
        ] as const),
      }) as import("@/modules/tenancy/policy").TenantContext,
  };
}

describe("rates and bays (#166)", { skip: shouldSkip }, () => {
  it("template application inherits the org labor rate and tax default", async () => {
    const { createServiceTemplate, applyServiceTemplateToWorkOrder } =
      await import("@/modules/work-orders/service-template-service");
    const seedData = await seedShop();
    const context = seedData.context();

    const { templateId } = await createServiceTemplate({
      db: dbModule.db,
      context,
      name: "Brake service",
      lines: [
        {
          // Labor line intentionally priced at zero — inherits $145/hr.
          kind: "LABOR",
          serviceGroupKey: "brakes",
          description: "Front brake labor",
          quantityMilli: 1000,
          unitPriceMinor: 0,
          taxable: true,
          taxRateBasisPoints: 0, // inherits org 7.2%
        },
        {
          // Priced part with explicit tax stays untouched.
          kind: "PART",
          serviceGroupKey: "brakes",
          description: "Pads",
          quantityMilli: 1000,
          unitPriceMinor: 9000,
          taxable: true,
          taxRateBasisPoints: 500,
        },
      ],
      tasks: [],
    });

    const result = await applyServiceTemplateToWorkOrder({
      db: dbModule.db,
      context,
      workOrderId: seedData.workOrderId,
      templateId,
    });

    const lines = await dbModule.db.estimateLine.findMany({
      where: { estimateRevisionId: result.revisionId! },
      orderBy: { position: "asc" },
    });
    // Labor: 1.0h × $145 = $145.00, tax 7.2% → $10.44 → $155.44
    expect(lines[0]?.unitPriceMinor).toBe(14500n);
    expect(lines[0]?.taxRateBasisPoints).toBe(720);
    expect(lines[0]?.totalMinor).toBe(15544n);
    // Priced part untouched: $90.00 + 5% → $94.50
    expect(lines[1]?.unitPriceMinor).toBe(9000n);
    expect(lines[1]?.taxRateBasisPoints).toBe(500);
    expect(lines[1]?.totalMinor).toBe(9450n);
  });

  it("manages named bays per location with tenant scoping", async () => {
    const { createBay, listBays, deactivateBay } =
      await import("@/modules/organizations/bay-service");
    const seedA = await seedShop();
    const seedB = await seedShop();

    await createBay({
      db: dbModule.db,
      context: seedA.context(),
      locationId: seedA.locationId,
      name: "Bay 1",
    });
    await createBay({
      db: dbModule.db,
      context: seedA.context(),
      locationId: seedA.locationId,
      name: "Lift 3",
    });
    await expect(
      createBay({
        db: dbModule.db,
        context: seedA.context(),
        locationId: seedA.locationId,
        name: "Bay 1",
      }),
    ).rejects.toMatchObject({ reason: "duplicate_name" });

    let bays = await listBays({
      db: dbModule.db,
      context: seedA.context(),
      locationId: seedA.locationId,
    });
    expect(bays.map((bay) => bay.name)).toEqual(["Bay 1", "Lift 3"]);

    await deactivateBay({ db: dbModule.db, context: seedA.context(), bayId: bays[1]!.id });
    bays = await listBays({
      db: dbModule.db,
      context: seedA.context(),
      locationId: seedA.locationId,
    });
    expect(bays).toHaveLength(1);

    // Cross-org: B's actor cannot create bays on A's location.
    await expect(
      createBay({
        db: dbModule.db,
        context: seedB.context(),
        locationId: seedA.locationId,
        name: "Intruder",
      }),
    ).rejects.toMatchObject({ reason: "location_not_found" });
  });
});
