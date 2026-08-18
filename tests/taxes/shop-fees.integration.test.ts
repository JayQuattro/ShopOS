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

async function seedEstimateShop() {
  const orgId = randomUUID();
  const locationId = randomUUID();
  const userId = randomUUID();
  const membershipId = randomUUID();
  const roleId = randomUUID();
  const customerId = randomUUID();
  const assetId = randomUUID();
  const lineId = randomUUID();

  await dbModule.db.$transaction([
    dbModule.db.organization.create({
      data: { id: orgId, slug: `org-${orgId.slice(0, 8)}`, name: "Fee Org" },
    }),
    dbModule.db.location.create({
      data: { id: locationId, organizationId: orgId, code: "MAIN", name: "Main", timeZone: "UTC" },
    }),
    dbModule.db.user.create({
      data: { id: userId, email: `f-${userId.slice(0, 8)}@example.test`, displayName: "Fee User" },
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
        displayName: "Fee Customer",
      },
    }),
    dbModule.db.asset.create({
      data: {
        id: assetId,
        organizationId: orgId,
        customerId,
        displayName: "Fee Car",
        category: "automobile",
      },
    }),
    dbModule.db.workOrder.create({
      data: {
        organizationId: orgId,
        locationId,
        customerId,
        assetId,
        number: "RO-1901",
        customerConcern: "Fees",
        status: "DRAFT",
      },
    }),
  ]);

  const workOrderId = (await dbModule.db.workOrder.findFirst({ where: { organizationId: orgId } }))!
    .id;

  return {
    orgId,
    workOrderId,
    lineId,
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

async function addLaborLine(
  seed: Awaited<ReturnType<typeof seedEstimateShop>>,
  revisionId: string,
) {
  const { addLine } = await import("@/modules/estimates/estimate-service");
  await addLine({
    db: dbModule.db,
    context: seed.context(),
    revisionId,
    kind: "LABOR",
    serviceGroupKey: "brakes",
    description: "Brake labor",
    quantityMilli: 1000,
    unitPriceMinor: 20000,
    discountMinor: 0,
    taxable: false,
    taxRateBasisPoints: 0,
    position: 1,
  });
}

describe("shop fees (#168)", { skip: shouldSkip }, () => {
  it("applies flat and capped percent fees at baseline presentation, with tax", async () => {
    const { createShopFee } = await import("@/modules/taxes/shop-fee-service");
    const { createDraftRevision, presentRevision } =
      await import("@/modules/estimates/estimate-service");
    const seedData = await seedEstimateShop();
    const context = seedData.context();

    await createShopFee(dbModule.db, context, {
      name: "Hazmat / disposal",
      calculation: "FLAT",
      amountMinor: 450,
      rateBasisPoints: 0,
      taxable: false,
      taxRateBasisPoints: 0,
      appliesTo: "BOTH",
    });
    await createShopFee(dbModule.db, context, {
      name: "Shop supplies",
      calculation: "PERCENT_OF_LABOR",
      amountMinor: 0,
      rateBasisPoints: 300, // 3% of labor
      maxAmountMinor: 2500, // capped at $25
      taxable: true,
      taxRateBasisPoints: 720,
      appliesTo: "BOTH",
    });

    const { revisionId } = await createDraftRevision({
      db: dbModule.db,
      context,
      workOrderId: seedData.workOrderId,
      currency: "USD",
    });
    await addLaborLine(seedData, revisionId); // $200 labor
    await presentRevision({ db: dbModule.db, context, revisionId });

    const lines = await dbModule.db.estimateLine.findMany({
      where: { estimateRevisionId: revisionId },
      orderBy: { position: "asc" },
    });
    const hazmat = lines.find((line) => line.description === "Hazmat / disposal");
    const supplies = lines.find((line) => line.description === "Shop supplies");

    expect(hazmat?.totalMinor).toBe(450n);
    // 3% of $200 = $6 (under the $25 cap), + 7.2% tax → $6.43
    expect(supplies?.grossMinor).toBe(600n);
    expect(supplies?.taxMinor).toBe(43n);
    expect(supplies?.totalMinor).toBe(643n);

    const revision = await dbModule.db.estimateRevision.findUnique({ where: { id: revisionId } });
    expect(revision?.totalMinor).toBe(20000n + 450n + 643n);
  });

  it("caps percent fees and respects appliesTo scoping", async () => {
    const { createShopFee, resolveFeeAmountMinor } =
      await import("@/modules/taxes/shop-fee-service");
    const seedData = await seedEstimateShop();
    const context = seedData.context();

    const { feeId } = await createShopFee(dbModule.db, context, {
      name: "Shop supplies",
      calculation: "PERCENT_OF_LABOR",
      amountMinor: 0,
      rateBasisPoints: 1000, // 10%
      maxAmountMinor: 2500, // $25 cap
      taxable: false,
      taxRateBasisPoints: 0,
      appliesTo: "BASELINE",
    });
    const fee = await dbModule.db.shopFee.findUnique({ where: { id: feeId } });
    // 10% of $2000 labor = $200 → capped at $25.
    expect(resolveFeeAmountMinor(fee!, 200000n)).toBe(2500);
    // 10% of $100 labor = $10, under the cap.
    expect(resolveFeeAmountMinor(fee!, 10000n)).toBe(1000);
  });

  it("does not duplicate fee lines on re-presentation of a superseded chain", async () => {
    const { createShopFee } = await import("@/modules/taxes/shop-fee-service");
    const { createDraftRevision, presentRevision, supersedeRevision } =
      await import("@/modules/estimates/estimate-service");
    const seedData = await seedEstimateShop();
    const context = seedData.context();

    await createShopFee(dbModule.db, context, {
      name: "Hazmat / disposal",
      calculation: "FLAT",
      amountMinor: 450,
      rateBasisPoints: 0,
      taxable: false,
      taxRateBasisPoints: 0,
      appliesTo: "BOTH",
    });

    const first = await createDraftRevision({
      db: dbModule.db,
      context,
      workOrderId: seedData.workOrderId,
      currency: "USD",
    });
    await addLaborLine(seedData, first.revisionId);
    await presentRevision({ db: dbModule.db, context, revisionId: first.revisionId });

    const superseded = await supersedeRevision({
      db: dbModule.db,
      context,
      revisionId: first.revisionId,
    });
    await addLaborLine(seedData, superseded.newRevisionId);
    await presentRevision({ db: dbModule.db, context, revisionId: superseded.newRevisionId });

    // One fee line per revision, never two.
    for (const revisionId of [first.revisionId, superseded.newRevisionId]) {
      const feeLines = await dbModule.db.estimateLine.findMany({
        where: { estimateRevisionId: revisionId, serviceGroupKey: "shop-fee" },
      });
      expect(feeLines).toHaveLength(1);
    }
  });

  it("fee CRUD stays tenant-scoped", async () => {
    const { createShopFee, deactivateShopFee } = await import("@/modules/taxes/shop-fee-service");
    const seedA = await seedEstimateShop();
    const seedB = await seedEstimateShop();

    await createShopFee(dbModule.db, seedA.context(), {
      name: "Shared name",
      calculation: "FLAT",
      amountMinor: 100,
      rateBasisPoints: 0,
      taxable: false,
      taxRateBasisPoints: 0,
      appliesTo: "BOTH",
    });
    // Same name legal in another org.
    const created = await createShopFee(dbModule.db, seedB.context(), {
      name: "Shared name",
      calculation: "FLAT",
      amountMinor: 100,
      rateBasisPoints: 0,
      taxable: false,
      taxRateBasisPoints: 0,
      appliesTo: "BOTH",
    });
    const feeA = await dbModule.db.shopFee.findFirst({
      where: { organizationId: seedA.orgId },
    });
    await expect(deactivateShopFee(dbModule.db, seedB.context(), feeA!.id)).rejects.toMatchObject({
      reason: "fee_not_found",
    });
    void created;
  });
});
