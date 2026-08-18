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
  const techId = randomUUID();
  const membershipId = randomUUID();
  const roleId = randomUUID();
  const customerId = randomUUID();

  await dbModule.db.$transaction([
    dbModule.db.organization.create({
      data: {
        id: orgId,
        slug: `org-${orgId.slice(0, 8)}`,
        name: "Report Org",
        defaultCurrency: "USD",
      },
    }),
    dbModule.db.location.create({
      data: { id: locationId, organizationId: orgId, code: "MAIN", name: "Main", timeZone: "UTC" },
    }),
    dbModule.db.user.create({
      data: {
        id: userId,
        email: `m-${userId.slice(0, 8)}@example.test`,
        displayName: "Report Manager",
      },
    }),
    dbModule.db.user.create({
      data: {
        id: techId,
        email: `t-${techId.slice(0, 8)}@example.test`,
        displayName: "Rita Report",
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
        displayName: "Report Customer",
      },
    }),
  ]);

  return {
    orgId,
    locationId,
    userId,
    techId,
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

describe("reports (#159)", { skip: shouldSkip }, () => {
  it("summarizes invoiced revenue, payments, ARO, and declined recovery", async () => {
    const { businessSummary } = await import("@/modules/reports/report-service");
    const seedData = await seedShop();
    const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const to = new Date(Date.now() + 5 * 60_000);

    // Two work orders: one invoiced + paid, one open.
    const woPaid = await dbModule.db.workOrder.create({
      data: {
        organizationId: seedData.orgId,
        locationId: seedData.locationId,
        customerId: seedData.customerId,
        number: "RO-1701",
        customerConcern: "a",
        status: "CLOSED",
      },
    });
    await dbModule.db.workOrder.create({
      data: {
        organizationId: seedData.orgId,
        locationId: seedData.locationId,
        customerId: seedData.customerId,
        number: "RO-1702",
        customerConcern: "b",
        status: "IN_PROGRESS",
        assignedTechnicianUserId: seedData.techId,
      },
    });

    await dbModule.db.invoice.create({
      data: {
        organizationId: seedData.orgId,
        locationId: seedData.locationId,
        workOrderId: woPaid.id,
        number: "INV-3001",
        status: "PARTIALLY_PAID",
        currency: "USD",
        subtotalMinor: 20000n,
        discountMinor: 0n,
        taxMinor: 0n,
        totalMinor: 20000n,
        paidMinor: 12000n,
        issuedAt: new Date(),
      },
    });
    await dbModule.db.payment.create({
      data: {
        organizationId: seedData.orgId,
        locationId: seedData.locationId,
        invoiceId: (await dbModule.db.invoice.findFirst({
          where: { organizationId: seedData.orgId },
        }))!.id,
        amountMinor: 12000n,
        currency: "USD",
        method: "CASH",
        receivedAt: new Date(),
        recordedByUserId: seedData.userId,
      },
    });

    // Declined line, later re-quoted as a change-order line with the same description.
    const openWo = await dbModule.db.workOrder.findFirst({
      where: { organizationId: seedData.orgId, number: "RO-1702" },
    });
    const baseline = await dbModule.db.estimateRevision.create({
      data: {
        organizationId: seedData.orgId,
        locationId: seedData.locationId,
        workOrderId: openWo!.id,
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
    });
    const declinedLine = await dbModule.db.estimateLine.create({
      data: {
        organizationId: seedData.orgId,
        estimateRevisionId: baseline.id,
        serviceGroupKey: "tires",
        kind: "PART",
        description: "Alignment",
        quantityMilli: 1000,
        unitPriceMinor: 8000n,
        grossMinor: 8000n,
        discountMinor: 0n,
        taxable: false,
        taxRateBasisPoints: 0,
        taxMinor: 0n,
        totalMinor: 8000n,
        position: 1,
      },
    });
    const authorization = await dbModule.db.authorization.create({
      data: {
        organizationId: seedData.orgId,
        estimateRevisionId: baseline.id,
        method: "PHONE",
        providedByName: "Report Customer",
        occurredAt: new Date(),
      },
    });
    await dbModule.db.authorizationDecision.create({
      data: {
        authorizationId: authorization.id,
        organizationId: seedData.orgId,
        estimateLineId: declinedLine.id,
        decision: "DECLINED",
      },
    });
    const requote = await dbModule.db.estimateRevision.create({
      data: {
        organizationId: seedData.orgId,
        locationId: seedData.locationId,
        workOrderId: openWo!.id,
        revisionNumber: 2,
        status: "PRESENTED",
        documentKind: "CHANGE_ORDER",
        changeOrderNumber: 1,
        currency: "USD",
        subtotalMinor: 8000n,
        discountMinor: 0n,
        taxMinor: 0n,
        totalMinor: 8000n,
        presentedAt: new Date(),
      },
    });
    await dbModule.db.estimateLine.create({
      data: {
        organizationId: seedData.orgId,
        estimateRevisionId: requote.id,
        serviceGroupKey: "tires",
        kind: "PART",
        description: "Alignment",
        quantityMilli: 1000,
        unitPriceMinor: 8000n,
        grossMinor: 8000n,
        discountMinor: 0n,
        taxable: false,
        taxRateBasisPoints: 0,
        taxMinor: 0n,
        totalMinor: 8000n,
        position: 1,
      },
    });

    const summary = await businessSummary({
      db: dbModule.db,
      context: seedData.context(),
      from,
      to,
    });
    expect(summary.workOrderCount).toBe(2);
    expect(summary.invoicedMinor).toBe(20000);
    expect(summary.paidMinor).toBe(12000);
    expect(summary.outstandingMinor).toBe(8000);
    expect(summary.averageRepairOrderMinor).toBe(20000);
    expect(summary.declinedCount).toBe(1);
    expect(summary.declinedMinor).toBe(8000);
    expect(summary.declinedRecoveredCount).toBe(1);
    expect(summary.declinedRecoveredMinor).toBe(8000);
  });

  it("rolls up technician time, assignments, findings, and QC passes", async () => {
    const { technicianProductivity } = await import("@/modules/reports/report-service");
    const seedData = await seedShop();
    const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const to = new Date(Date.now() + 5 * 60_000);

    const wo = await dbModule.db.workOrder.create({
      data: {
        organizationId: seedData.orgId,
        locationId: seedData.locationId,
        customerId: seedData.customerId,
        number: "RO-1703",
        customerConcern: "c",
        status: "IN_PROGRESS",
        assignedTechnicianUserId: seedData.techId,
        qcStatus: "passed",
        qcPassedByUserId: seedData.techId,
        qcPassedAt: new Date(),
      },
    });
    await dbModule.db.workOrderTask.create({
      data: {
        organizationId: seedData.orgId,
        locationId: seedData.locationId,
        workOrderId: wo.id,
        position: 1,
        title: "Worn pads",
        status: "NEEDS_ATTENTION",
        createdByUserId: seedData.techId,
      },
    });
    await dbModule.db.timeEntry.create({
      data: {
        organizationId: seedData.orgId,
        locationId: seedData.locationId,
        workOrderId: wo.id,
        userId: seedData.techId,
        startedAt: new Date(Date.now() - 90 * 60_000),
        endedAt: new Date(Date.now() - 30 * 60_000),
      },
    });

    const rows = await technicianProductivity({
      db: dbModule.db,
      context: seedData.context(),
      from,
      to,
    });
    const tech = rows.find((row) => row.userId === seedData.techId);
    expect(tech).toBeDefined();
    expect(tech?.workOrdersAssigned).toBe(1);
    expect(tech?.loggedMinutes).toBe(60);
    expect(tech?.flaggedFindings).toBe(1);
    expect(tech?.qualityChecksPassed).toBe(1);
  });

  it("keeps reports tenant-scoped", async () => {
    const { businessSummary, technicianProductivity } =
      await import("@/modules/reports/report-service");
    const seedA = await seedShop();
    const seedB = await seedShop();
    const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const to = new Date(Date.now() + 5 * 60_000);

    await dbModule.db.workOrder.create({
      data: {
        organizationId: seedA.orgId,
        locationId: seedA.locationId,
        customerId: seedA.customerId,
        number: "RO-1704",
        customerConcern: "x",
        status: "IN_PROGRESS",
      },
    });

    const summaryB = await businessSummary({ db: dbModule.db, context: seedB.context(), from, to });
    const techB = await technicianProductivity({
      db: dbModule.db,
      context: seedB.context(),
      from,
      to,
    });
    expect(summaryB.workOrderCount).toBe(0);
    expect(techB).toHaveLength(0);
  });
});
