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

async function seedShop(name: string) {
  const orgId = randomUUID();
  const locationId = randomUUID();
  const userId = randomUUID();
  const membershipId = randomUUID();
  const roleId = randomUUID();
  const customerId = randomUUID();

  await dbModule.db.$transaction([
    dbModule.db.organization.create({
      data: { id: orgId, slug: `org-${orgId.slice(0, 8)}`, name, defaultCurrency: "USD" },
    }),
    dbModule.db.location.create({
      data: { id: locationId, organizationId: orgId, code: "MAIN", name: "Main", timeZone: "UTC" },
    }),
    dbModule.db.user.create({
      data: {
        id: userId,
        email: `jm-${userId.slice(0, 8)}@example.test`,
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

type LineSpec = Readonly<{
  kind: "PART" | "LABOR" | "FEE";
  totalMinor: bigint;
  quantityMilli: number;
  itemId?: string;
  groupKey: string;
  groupLabel: string;
}>;

/** An issued invoice whose lines carry job grouping via source estimate lines. */
async function issuedInvoice(opts: {
  orgId: string;
  locationId: string;
  customerId: string;
  number: string;
  lines: readonly LineSpec[];
}) {
  const wo = await dbModule.db.workOrder.create({
    data: {
      organizationId: opts.orgId,
      locationId: opts.locationId,
      customerId: opts.customerId,
      number: opts.number,
      customerConcern: "margin",
      status: "CLOSED",
    },
  });
  const revision = await dbModule.db.estimateRevision.create({
    data: {
      organizationId: opts.orgId,
      locationId: opts.locationId,
      workOrderId: wo.id,
      revisionNumber: 1,
      status: "SUPERSEDED",
      documentKind: "BASELINE",
      currency: "USD",
      subtotalMinor: 0n,
      discountMinor: 0n,
      taxMinor: 0n,
      totalMinor: 0n,
      presentedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
    },
  });
  const invoice = await dbModule.db.invoice.create({
    data: {
      organizationId: opts.orgId,
      locationId: opts.locationId,
      workOrderId: wo.id,
      number: `INV-${opts.number}`,
      status: "PAID",
      currency: "USD",
      subtotalMinor: 0n,
      discountMinor: 0n,
      taxMinor: 0n,
      totalMinor: 0n,
      paidMinor: 0n,
      issuedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    },
  });
  let position = 0;
  for (const spec of opts.lines) {
    position += 1;
    const estimateLine = await dbModule.db.estimateLine.create({
      data: {
        organizationId: opts.orgId,
        estimateRevisionId: revision.id,
        serviceGroupKey: spec.groupKey,
        serviceGroupLabel: spec.groupLabel,
        kind: spec.kind,
        description: spec.groupLabel,
        quantityMilli: spec.quantityMilli,
        unitPriceMinor: spec.totalMinor,
        grossMinor: spec.totalMinor,
        discountMinor: 0n,
        taxable: false,
        taxRateBasisPoints: 0,
        taxMinor: 0n,
        totalMinor: spec.totalMinor,
        position,
      },
    });
    await dbModule.db.invoiceLine.create({
      data: {
        organizationId: opts.orgId,
        invoiceId: invoice.id,
        sourceEstimateLineId: estimateLine.id,
        kind: spec.kind,
        description: spec.groupLabel,
        quantityMilli: spec.quantityMilli,
        unitPriceMinor: spec.totalMinor,
        grossMinor: spec.totalMinor,
        discountMinor: 0n,
        taxable: false,
        taxRateBasisPoints: 0,
        taxMinor: 0n,
        totalMinor: spec.totalMinor,
        position,
        ...(spec.itemId ? { inventoryItemId: spec.itemId } : {}),
      },
    });
  }
  return invoice;
}

describe("job margins (#243)", { skip: shouldSkip }, () => {
  it("computes parts margin per job with zero cost for unlinked parts", async () => {
    const { jobMargins } = await import("@/modules/reports/report-service");
    const seed = await seedShop("Margin");
    const stocked = await dbModule.db.inventoryItem.create({
      data: {
        organizationId: seed.orgId,
        partNumber: "PAD-M",
        name: "Pads",
        quantityOnHand: 10,
        unitCostMinor: 2_500n, // $25 each
      },
    });
    await issuedInvoice({
      ...seed,
      number: "8001",
      lines: [
        // Front brakes: 2 stocked pads sold at $80 each → $160 rev, $50 cost
        {
          kind: "PART",
          totalMinor: 16_000n,
          quantityMilli: 2000,
          itemId: stocked.id,
          groupKey: "front-brakes",
          groupLabel: "Front brakes",
        },
        // Labor on the same job: revenue only
        {
          kind: "LABOR",
          totalMinor: 12_000n,
          quantityMilli: 1000,
          groupKey: "front-brakes",
          groupLabel: "Front brakes",
        },
        // Customer-supplied rotors on a tune job: revenue, zero shop cost
        {
          kind: "PART",
          totalMinor: 3_000n,
          quantityMilli: 1000,
          groupKey: "tune-up",
          groupLabel: "Tune up",
        },
        {
          kind: "FEE",
          totalMinor: 500n,
          quantityMilli: 1000,
          groupKey: "tune-up",
          groupLabel: "Tune up",
        },
      ],
    });

    const margins = await jobMargins({
      db: dbModule.db,
      context: seed.context(),
      from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      to: new Date(Date.now() + 60 * 60 * 1000),
    });

    const brakes = margins.find((row) => row.label === "Front brakes")!;
    expect(brakes.partsRevenueMinor).toBe(16_000);
    expect(brakes.partsCostMinor).toBe(5_000);
    expect(brakes.marginMinor).toBe(11_000);
    expect(brakes.marginPct).toBe(69);
    expect(brakes.laborRevenueMinor).toBe(12_000);

    const tune = margins.find((row) => row.label === "Tune up")!;
    expect(tune.partsCostMinor).toBe(0);
    expect(tune.marginMinor).toBe(3_000);
    expect(tune.feesRevenueMinor).toBe(500);

    // Sorted by margin: brakes first.
    expect(margins[0]!.label).toBe("Front brakes");
  });

  it("computes whole-invoice margin for the work order card", async () => {
    const { invoicePartsMargin } = await import("@/modules/reports/report-service");
    const seed = await seedShop("InvoiceMargin");
    const stocked = await dbModule.db.inventoryItem.create({
      data: {
        organizationId: seed.orgId,
        partNumber: "OIL-M",
        name: "Oil",
        quantityOnHand: 20,
        unitCostMinor: 500n,
      },
    });
    const invoice = await issuedInvoice({
      ...seed,
      number: "8002",
      lines: [
        {
          kind: "PART",
          totalMinor: 6_000n,
          quantityMilli: 5000,
          itemId: stocked.id,
          groupKey: "oil",
          groupLabel: "Oil change",
        }, // 5 qt × $5 = $25 cost
        {
          kind: "LABOR",
          totalMinor: 4_000n,
          quantityMilli: 1000,
          groupKey: "oil",
          groupLabel: "Oil change",
        },
      ],
    });

    const margin = await invoicePartsMargin({
      db: dbModule.db,
      context: seed.context(),
      invoiceId: invoice.id,
    });
    expect(margin).toMatchObject({
      partsRevenueMinor: 6_000,
      partsCostMinor: 2_500,
      laborRevenueMinor: 4_000,
      marginMinor: 3_500,
      marginPct: 58,
    });
  });

  it("keeps another organization's invoices out", async () => {
    const { jobMargins, invoicePartsMargin } = await import("@/modules/reports/report-service");
    const seedA = await seedShop("MarginA");
    const seedB = await seedShop("MarginB");
    const stocked = await dbModule.db.inventoryItem.create({
      data: {
        organizationId: seedA.orgId,
        partNumber: "ISO-M",
        name: "Isolated",
        quantityOnHand: 5,
        unitCostMinor: 100n,
      },
    });
    const invoice = await issuedInvoice({
      ...seedA,
      number: "8003",
      lines: [
        {
          kind: "PART",
          totalMinor: 1_000n,
          quantityMilli: 1000,
          itemId: stocked.id,
          groupKey: "g",
          groupLabel: "G",
        },
      ],
    });

    const margins = await jobMargins({
      db: dbModule.db,
      context: seedB.context(),
      from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      to: new Date(Date.now() + 60 * 60 * 1000),
    });
    expect(margins).toEqual([]);

    const foreign = await invoicePartsMargin({
      db: dbModule.db,
      context: seedB.context(),
      invoiceId: invoice.id,
    });
    expect(foreign).toBeNull();
  });
});
