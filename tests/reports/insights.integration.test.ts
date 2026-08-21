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

const DAY = 24 * 60 * 60 * 1000;

async function seedShop(name: string) {
  const orgId = randomUUID();
  const locationId = randomUUID();
  const userId = randomUUID();
  const membershipId = randomUUID();
  const roleId = randomUUID();
  const customerId = randomUUID();

  await dbModule.db.$transaction([
    dbModule.db.organization.create({
      data: {
        id: orgId,
        slug: `org-${orgId.slice(0, 8)}`,
        name,
        defaultCurrency: "USD",
      },
    }),
    dbModule.db.location.create({
      data: { id: locationId, organizationId: orgId, code: "MAIN", name: "Main", timeZone: "UTC" },
    }),
    dbModule.db.user.create({
      data: {
        id: userId,
        email: `i-${userId.slice(0, 8)}@example.test`,
        displayName: `${name} User`,
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
        permissions: ["work_orders.read", "work_orders.write"],
      },
    }),
    dbModule.db.membershipRole.create({ data: { organizationId: orgId, membershipId, roleId } }),
    dbModule.db.customer.create({
      data: {
        id: customerId,
        organizationId: orgId,
        kind: "INDIVIDUAL",
        displayName: `${name} Customer`,
      },
    }),
  ]);

  return {
    orgId,
    locationId,
    userId,
    customerId,
    context: () =>
      ({
        actorId: userId,
        organizationId: orgId,
        membershipId,
        requestId: randomUUID(),
        organizationWideLocationAccess: true,
        allowedLocationIds: new Set<string>(),
        permissions: new Set(["work_orders.read", "work_orders.write"] as const),
      }) as import("@/modules/tenancy/policy").TenantContext,
  };
}

function estimateLineData(overrides: Record<string, unknown> = {}) {
  // Keep the arithmetic consistent with the estimate_lines_values_check
  // constraint: total = gross - discount + tax.
  const total = (overrides.totalMinor as bigint | undefined) ?? 0n;
  return {
    organizationId: undefined as unknown as string,
    estimateRevisionId: undefined as unknown as string,
    serviceGroupKey: "general",
    kind: "LABOR" as const,
    description: "Line",
    quantityMilli: 1000,
    unitPriceMinor: total,
    grossMinor: total,
    discountMinor: 0n,
    taxable: false,
    taxRateBasisPoints: 0,
    taxMinor: 0n,
    totalMinor: total,
    position: 1,
    ...overrides,
  };
}

describe("reports: insights (#234)", { skip: shouldSkip }, () => {
  it("buckets invoiced and collected money by day, including empty buckets", async () => {
    const { revenueTrend } = await import("@/modules/reports/report-service");
    const seed = await seedShop("Trend");
    const from = new Date(Date.now() - 7 * DAY);
    const to = new Date(Date.now() + 60 * 60 * 1000);

    const wo = await dbModule.db.workOrder.create({
      data: {
        organizationId: seed.orgId,
        locationId: seed.locationId,
        customerId: seed.customerId,
        number: "RO-1801",
        customerConcern: "brakes",
        status: "CLOSED",
      },
    });
    const issuedAt = new Date(Date.now() - 3 * DAY);
    const invoice = await dbModule.db.invoice.create({
      data: {
        organizationId: seed.orgId,
        locationId: seed.locationId,
        workOrderId: wo.id,
        number: "INV-4001",
        status: "PARTIALLY_PAID",
        currency: "USD",
        subtotalMinor: 20000n,
        discountMinor: 0n,
        taxMinor: 0n,
        totalMinor: 20000n,
        paidMinor: 12000n,
        issuedAt,
      },
    });
    // A voided invoice must not count anywhere.
    const woVoid = await dbModule.db.workOrder.create({
      data: {
        organizationId: seed.orgId,
        locationId: seed.locationId,
        customerId: seed.customerId,
        number: "RO-1802",
        customerConcern: "void me",
        status: "CLOSED",
      },
    });
    await dbModule.db.invoice.create({
      data: {
        organizationId: seed.orgId,
        locationId: seed.locationId,
        workOrderId: woVoid.id,
        number: "INV-4002",
        status: "VOID",
        currency: "USD",
        subtotalMinor: 9999n,
        discountMinor: 0n,
        taxMinor: 0n,
        totalMinor: 9999n,
        paidMinor: 0n,
        issuedAt: new Date(Date.now() - 2 * DAY),
      },
    });
    await dbModule.db.payment.create({
      data: {
        organizationId: seed.orgId,
        locationId: seed.locationId,
        invoiceId: invoice.id,
        amountMinor: 12000n,
        currency: "USD",
        method: "CASH",
        receivedAt: issuedAt,
        recordedByUserId: seed.userId,
      },
    });

    const buckets = await revenueTrend({
      db: dbModule.db,
      context: seed.context(),
      from,
      to,
      bucket: "day",
    });

    expect(buckets.length).toBeGreaterThanOrEqual(7);
    for (const bucket of buckets) {
      expect(bucket.start.getUTCHours()).toBe(0);
      expect(bucket.start.getUTCMinutes()).toBe(0);
    }
    expect(buckets.reduce((sum, b) => sum + b.invoicedMinor, 0)).toBe(20000);
    expect(buckets.reduce((sum, b) => sum + b.collectedMinor, 0)).toBe(12000);
    const invoiceBucket = buckets.find(
      (b) =>
        b.start.getTime() ===
        new Date(
          Date.UTC(issuedAt.getUTCFullYear(), issuedAt.getUTCMonth(), issuedAt.getUTCDate()),
        ).getTime(),
    );
    expect(invoiceBucket?.invoicedMinor).toBe(20000);
    expect(invoiceBucket?.collectedMinor).toBe(12000);
  });

  it("splits issued revenue across labor, parts, and fees", async () => {
    const { workMix } = await import("@/modules/reports/report-service");
    const seed = await seedShop("Mix");
    const from = new Date(Date.now() - 7 * DAY);
    const to = new Date(Date.now() + 60 * 60 * 1000);

    const wo = await dbModule.db.workOrder.create({
      data: {
        organizationId: seed.orgId,
        locationId: seed.locationId,
        customerId: seed.customerId,
        number: "RO-1810",
        customerConcern: "mix",
        status: "CLOSED",
      },
    });
    const invoice = await dbModule.db.invoice.create({
      data: {
        organizationId: seed.orgId,
        locationId: seed.locationId,
        workOrderId: wo.id,
        number: "INV-4010",
        status: "ISSUED",
        currency: "USD",
        subtotalMinor: 20000n,
        discountMinor: 0n,
        taxMinor: 0n,
        totalMinor: 20000n,
        paidMinor: 0n,
        issuedAt: new Date(Date.now() - DAY),
      },
    });
    let position = 0;
    for (const [kind, minor] of [
      ["LABOR", 12000n],
      ["PART", 6000n],
      ["FEE", 2000n],
    ] as const) {
      await dbModule.db.invoiceLine.create({
        data: {
          organizationId: seed.orgId,
          invoiceId: invoice.id,
          kind,
          description: `${kind} line`,
          quantityMilli: 1000,
          unitPriceMinor: minor,
          grossMinor: minor,
          discountMinor: 0n,
          taxable: false,
          taxRateBasisPoints: 0,
          taxMinor: 0n,
          totalMinor: minor,
          position: position++,
        },
      });
    }

    const mix = await workMix({ db: dbModule.db, context: seed.context(), from, to });
    expect(mix).toEqual({ laborMinor: 12000, partsMinor: 6000, feesMinor: 2000, currency: "USD" });
  });

  it("funnels presented estimate dollars into approved, declined, and pending", async () => {
    const { estimateFunnel } = await import("@/modules/reports/report-service");
    const seed = await seedShop("Funnel");
    const from = new Date(Date.now() - 7 * DAY);
    const to = new Date(Date.now() + 60 * 60 * 1000);

    const wo = await dbModule.db.workOrder.create({
      data: {
        organizationId: seed.orgId,
        locationId: seed.locationId,
        customerId: seed.customerId,
        number: "RO-1820",
        customerConcern: "funnel",
        status: "IN_PROGRESS",
      },
    });
    const revision = await dbModule.db.estimateRevision.create({
      data: {
        organizationId: seed.orgId,
        locationId: seed.locationId,
        workOrderId: wo.id,
        revisionNumber: 1,
        status: "PRESENTED",
        documentKind: "BASELINE",
        currency: "USD",
        subtotalMinor: 10000n,
        discountMinor: 0n,
        taxMinor: 0n,
        totalMinor: 10000n,
        presentedAt: new Date(Date.now() - 2 * DAY),
      },
    });
    const lineApproved = await dbModule.db.estimateLine.create({
      data: estimateLineData({
        organizationId: seed.orgId,
        estimateRevisionId: revision.id,
        totalMinor: 5000n,
        position: 1,
        description: "approved",
      }),
    });
    const lineDeclined = await dbModule.db.estimateLine.create({
      data: estimateLineData({
        organizationId: seed.orgId,
        estimateRevisionId: revision.id,
        totalMinor: 3000n,
        position: 2,
        description: "declined",
      }),
    });
    await dbModule.db.estimateLine.create({
      data: estimateLineData({
        organizationId: seed.orgId,
        estimateRevisionId: revision.id,
        totalMinor: 2000n,
        position: 3,
        description: "pending",
      }),
    });
    const authorization = await dbModule.db.authorization.create({
      data: {
        organizationId: seed.orgId,
        estimateRevisionId: revision.id,
        method: "CUSTOMER_LINK",
        providedByName: "Funnel Customer",
        occurredAt: new Date(Date.now() - DAY),
      },
    });
    await dbModule.db.authorizationDecision.create({
      data: {
        organizationId: seed.orgId,
        authorizationId: authorization.id,
        estimateLineId: lineApproved.id,
        decision: "APPROVED",
      },
    });
    await dbModule.db.authorizationDecision.create({
      data: {
        organizationId: seed.orgId,
        authorizationId: authorization.id,
        estimateLineId: lineDeclined.id,
        decision: "DECLINED",
      },
    });

    const funnel = await estimateFunnel({ db: dbModule.db, context: seed.context(), from, to });
    expect(funnel).toEqual({
      presentedCount: 1,
      presentedMinor: 10000,
      approvedMinor: 5000,
      declinedMinor: 3000,
      pendingMinor: 2000,
    });
  });

  it("ranks job groups by invoice revenue with ungrouped lines as other items", async () => {
    const { topJobs } = await import("@/modules/reports/report-service");
    const seed = await seedShop("TopJobs");
    const from = new Date(Date.now() - 7 * DAY);
    const to = new Date(Date.now() + 60 * 60 * 1000);

    const wo = await dbModule.db.workOrder.create({
      data: {
        organizationId: seed.orgId,
        locationId: seed.locationId,
        customerId: seed.customerId,
        number: "RO-1830",
        customerConcern: "jobs",
        status: "CLOSED",
      },
    });
    const revision = await dbModule.db.estimateRevision.create({
      data: {
        organizationId: seed.orgId,
        locationId: seed.locationId,
        workOrderId: wo.id,
        revisionNumber: 1,
        status: "SUPERSEDED",
        documentKind: "BASELINE",
        currency: "USD",
        subtotalMinor: 0n,
        discountMinor: 0n,
        taxMinor: 0n,
        totalMinor: 0n,
        presentedAt: new Date(Date.now() - 3 * DAY),
      },
    });
    const brakeLine = await dbModule.db.estimateLine.create({
      data: estimateLineData({
        organizationId: seed.orgId,
        estimateRevisionId: revision.id,
        serviceGroupKey: "front-brakes",
        serviceGroupLabel: "Front brakes",
        kind: "PART",
        totalMinor: 18000n,
        position: 1,
        description: "brakes",
      }),
    });
    const invoice = await dbModule.db.invoice.create({
      data: {
        organizationId: seed.orgId,
        locationId: seed.locationId,
        workOrderId: wo.id,
        number: "INV-4030",
        status: "PAID",
        currency: "USD",
        subtotalMinor: 20000n,
        discountMinor: 0n,
        taxMinor: 0n,
        totalMinor: 20000n,
        paidMinor: 20000n,
        issuedAt: new Date(Date.now() - DAY),
      },
    });
    await dbModule.db.invoiceLine.create({
      data: {
        organizationId: seed.orgId,
        invoiceId: invoice.id,
        sourceEstimateLineId: brakeLine.id,
        kind: "PART",
        description: "Front brakes",
        quantityMilli: 1000,
        unitPriceMinor: 18000n,
        grossMinor: 18000n,
        discountMinor: 0n,
        taxable: false,
        taxRateBasisPoints: 0,
        taxMinor: 0n,
        totalMinor: 18000n,
        position: 1,
      },
    });
    await dbModule.db.invoiceLine.create({
      data: {
        organizationId: seed.orgId,
        invoiceId: invoice.id,
        kind: "FEE",
        description: "Shop supplies",
        quantityMilli: 1000,
        unitPriceMinor: 2000n,
        grossMinor: 2000n,
        discountMinor: 0n,
        taxable: false,
        taxRateBasisPoints: 0,
        taxMinor: 0n,
        totalMinor: 2000n,
        position: 2,
      },
    });

    const jobs = await topJobs({ db: dbModule.db, context: seed.context(), from, to, limit: 5 });
    expect(jobs).toEqual([
      { label: "Front brakes", invoiceCount: 1, minor: 18000 },
      { label: "Other items", invoiceCount: 1, minor: 2000 },
    ]);
  });

  it("returns empty insights for another organization over the same window", async () => {
    const { revenueTrend, workMix, estimateFunnel, topJobs } =
      await import("@/modules/reports/report-service");
    const seedA = await seedShop("Isolated");
    const seedB = await seedShop("OtherOrg");
    const from = new Date(Date.now() - 7 * DAY);
    const to = new Date(Date.now() + 60 * 60 * 1000);

    // Org A has real money moving.
    const wo = await dbModule.db.workOrder.create({
      data: {
        organizationId: seedA.orgId,
        locationId: seedA.locationId,
        customerId: seedA.customerId,
        number: "RO-1840",
        customerConcern: "isolation",
        status: "CLOSED",
      },
    });
    const invoice = await dbModule.db.invoice.create({
      data: {
        organizationId: seedA.orgId,
        locationId: seedA.locationId,
        workOrderId: wo.id,
        number: "INV-4040",
        status: "ISSUED",
        currency: "USD",
        subtotalMinor: 15000n,
        discountMinor: 0n,
        taxMinor: 0n,
        totalMinor: 15000n,
        paidMinor: 0n,
        issuedAt: new Date(Date.now() - DAY),
      },
    });
    await dbModule.db.invoiceLine.create({
      data: {
        organizationId: seedA.orgId,
        invoiceId: invoice.id,
        kind: "LABOR",
        description: "labor",
        quantityMilli: 1000,
        unitPriceMinor: 15000n,
        grossMinor: 15000n,
        discountMinor: 0n,
        taxable: false,
        taxRateBasisPoints: 0,
        taxMinor: 0n,
        totalMinor: 15000n,
        position: 1,
      },
    });

    const db = dbModule.db;
    const contextB = seedB.context();
    const trend = await revenueTrend({ db, context: contextB, from, to, bucket: "day" });
    expect(trend.reduce((sum, b) => sum + b.invoicedMinor + b.collectedMinor, 0)).toBe(0);
    const mix = await workMix({ db, context: contextB, from, to });
    expect(mix.laborMinor + mix.partsMinor + mix.feesMinor).toBe(0);
    const funnel = await estimateFunnel({ db, context: contextB, from, to });
    expect(funnel.presentedCount).toBe(0);
    const jobs = await topJobs({ db, context: contextB, from, to });
    expect(jobs).toEqual([]);
  });
});
