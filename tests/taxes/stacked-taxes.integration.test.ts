import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { computeStackedTax, resolveTaxComponents } from "@/modules/taxes/tax-stacks";
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

describe("stacked tax computation (#196)", () => {
  it("applies each component on the same base, rounding separately, and sums", () => {
    // Canada classic: 5% GST + 9.975% QST on a 123.45 base.
    const { taxMinor, effectiveBasisPoints, breakdown } = computeStackedTax(123_45, [
      { name: "GST", rateBasisPoints: 500 },
      { name: "QST", rateBasisPoints: 998 },
    ]);

    expect(effectiveBasisPoints).toBe(1498);
    // GST: 6.17; QST: 12.32 — each rounded on its own.
    expect(breakdown.map((c) => `${c.name}:${c.amountMinor}`)).toEqual(["GST:617", "QST:1232"]);
    expect(taxMinor).toBe(1849);
  });

  it("resolves a single rate to itself and stacks groups in sort order", async () => {
    const orgId = randomUUID();
    const otherOrgId = randomUUID();
    await dbModule.db.$transaction([
      dbModule.db.organization.create({
        data: { id: orgId, slug: `o-${orgId.slice(0, 8)}`, name: "CA Org" },
      }),
      dbModule.db.organization.create({
        data: { id: otherOrgId, slug: `x-${otherOrgId.slice(0, 8)}`, name: "X Org" },
      }),
    ]);
    const gst = randomUUID();
    const qst = randomUUID();
    const lone = randomUUID();
    const foreign = randomUUID();
    await dbModule.db.$transaction([
      dbModule.db.taxRate.create({
        data: {
          id: gst,
          organizationId: orgId,
          name: "GST",
          rateBasisPoints: 500,
          stackGroup: "canada",
          sortOrder: 1,
        },
      }),
      dbModule.db.taxRate.create({
        data: {
          id: qst,
          organizationId: orgId,
          name: "QST",
          rateBasisPoints: 998,
          stackGroup: "canada",
          sortOrder: 2,
        },
      }),
      dbModule.db.taxRate.create({
        data: { id: lone, organizationId: orgId, name: "Flat", rateBasisPoints: 700 },
      }),
      dbModule.db.taxRate.create({
        data: {
          id: foreign,
          organizationId: otherOrgId,
          name: "GST",
          rateBasisPoints: 500,
          stackGroup: "canada",
        },
      }),
    ]);

    const stack = await resolveTaxComponents(dbModule.db, orgId, gst);
    expect(stack).toEqual([
      { name: "GST", rateBasisPoints: 500 },
      { name: "QST", rateBasisPoints: 998 },
    ]);

    const single = await resolveTaxComponents(dbModule.db, orgId, lone);
    expect(single).toEqual([{ name: "Flat", rateBasisPoints: 700 }]);

    // Another org's rate id resolves nothing — stacks never leak tenants.
    expect(await resolveTaxComponents(dbModule.db, orgId, foreign)).toBeNull();
    expect(await resolveTaxComponents(dbModule.db, orgId, randomUUID())).toBeNull();
  });
});

async function seedShop() {
  const orgId = randomUUID();
  const locationId = randomUUID();
  const userId = randomUUID();
  const membershipId = randomUUID();
  const roleId = randomUUID();
  const customerId = randomUUID();
  const workOrderId = randomUUID();

  await dbModule.db.$transaction([
    dbModule.db.organization.create({
      data: { id: orgId, slug: `org-${orgId.slice(0, 8)}`, name: "Stack Org" },
    }),
    dbModule.db.location.create({
      data: { id: locationId, organizationId: orgId, code: "MAIN", name: "Main", timeZone: "UTC" },
    }),
    dbModule.db.user.create({
      data: {
        id: userId,
        email: `st-${userId.slice(0, 8)}@example.test`,
        displayName: "Stack User",
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
        permissions: ["work_orders.write", "work_orders.read"],
      },
    }),
    dbModule.db.membershipRole.create({ data: { organizationId: orgId, membershipId, roleId } }),
    dbModule.db.customer.create({
      data: {
        id: customerId,
        organizationId: orgId,
        kind: "INDIVIDUAL",
        displayName: "Stack Customer",
      },
    }),
    dbModule.db.workOrder.create({
      data: {
        id: workOrderId,
        organizationId: orgId,
        locationId,
        customerId,
        number: "RO-CA1",
        customerConcern: "stack test",
        status: "ESTIMATING",
      },
    }),
  ]);

  const context = () =>
    ({
      actorId: userId,
      organizationId: orgId,
      membershipId,
      requestId: randomUUID(),
      organizationWideLocationAccess: true,
      allowedLocationIds: new Set<string>(),
      permissions: new Set(["work_orders.write", "work_orders.read"]),
    }) as import("@/modules/tenancy/policy").TenantContext;

  return { orgId, workOrderId, context };
}

describe("stacked tax lines (#196)", { skip: shouldSkip }, () => {
  it("applies a stack to an estimate line and snapshots the components", async () => {
    const estimateService = await import("@/modules/estimates/estimate-service");
    const seed = await seedShop();

    const gst = randomUUID();
    const qst = randomUUID();
    await dbModule.db.$transaction([
      dbModule.db.taxRate.create({
        data: {
          id: gst,
          organizationId: seed.orgId,
          name: "GST",
          rateBasisPoints: 500,
          stackGroup: "canada",
          sortOrder: 1,
        },
      }),
      dbModule.db.taxRate.create({
        data: {
          id: qst,
          organizationId: seed.orgId,
          name: "QST",
          rateBasisPoints: 998,
          stackGroup: "canada",
          sortOrder: 2,
        },
      }),
    ]);

    const { revisionId } = await estimateService.createDraftRevision({
      db: dbModule.db,
      context: seed.context(),
      workOrderId: seed.workOrderId,
      currency: "CAD",
    });
    await estimateService.addLine({
      db: dbModule.db,
      context: seed.context(),
      revisionId,
      serviceGroupKey: "labor",
      kind: "LABOR",
      description: "Brake job",
      quantityMilli: 1000,
      unitPriceMinor: 123_45,
      discountMinor: 0,
      taxable: true,
      taxRateBasisPoints: 0,
      taxRateId: gst,
      position: 1,
    });

    const line = await dbModule.db.estimateLine.findFirst({
      where: { estimateRevisionId: revisionId },
      select: { taxRateBasisPoints: true, taxMinor: true, totalMinor: true, taxComponents: true },
    });
    // Effective combined rate stored on the line; components snapshotted.
    expect(line?.taxRateBasisPoints).toBe(1498);
    expect(line?.taxMinor).toBe(1849n);
    expect(line?.totalMinor).toBe(141_94n);
    expect(line?.taxComponents).toEqual([
      { name: "GST", rateBasisPoints: 500, amountMinor: 617 },
      { name: "QST", rateBasisPoints: 998, amountMinor: 1232 },
    ]);
  });

  it("rejects foreign or unknown rate ids without writing", async () => {
    const estimateService = await import("@/modules/estimates/estimate-service");
    const seed = await seedShop();

    const { revisionId } = await estimateService.createDraftRevision({
      db: dbModule.db,
      context: seed.context(),
      workOrderId: seed.workOrderId,
      currency: "CAD",
    });
    await expect(
      estimateService.addLine({
        db: dbModule.db,
        context: seed.context(),
        revisionId,
        serviceGroupKey: "labor",
        kind: "LABOR",
        description: "Bad",
        quantityMilli: 1000,
        unitPriceMinor: 100,
        discountMinor: 0,
        taxable: true,
        taxRateBasisPoints: 0,
        taxRateId: randomUUID(),
        position: 1,
      }),
    ).rejects.toMatchObject({ reason: "tax_rate_not_found" });
    expect(
      await dbModule.db.estimateLine.count({ where: { estimateRevisionId: revisionId } }),
    ).toBe(0);
  });
});
