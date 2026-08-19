import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { calculateLine } from "@/modules/shared/money";
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

const LINE = {
  id: "t",
  kind: "labor",
  quantityMilli: 1000,
  unitPriceMinor: 100_00,
  discountMinor: 0,
  taxable: true,
  taxRateBasisPoints: 2000, // 20% VAT
  authorization: "pending",
} as const;

describe("VAT-inclusive pricing kernel (#195)", () => {
  it("backs the tax out of an inclusive price without changing what the customer pays", () => {
    const exclusive = calculateLine({ ...LINE });
    expect(exclusive.taxMinor).toBe(20_00);
    expect(exclusive.totalMinor).toBe(120_00);

    const inclusive = calculateLine({ ...LINE, taxMode: "INCLUSIVE" });
    // The customer pays the entered 100.00; VAT inside it is 16.67.
    expect(inclusive.totalMinor).toBe(100_00);
    expect(inclusive.taxMinor).toBe(16_67);
    // Components always sum back to the total exactly.
    expect(inclusive.totalMinor - inclusive.taxMinor).toBe(83_33);
  });

  it("keeps non-taxable lines untouched in both modes", () => {
    const inclusive = calculateLine({ ...LINE, taxable: false, taxMode: "INCLUSIVE" });
    expect(inclusive.taxMinor).toBe(0);
    expect(inclusive.totalMinor).toBe(100_00);
  });

  it("applies discounts before backing tax out", () => {
    const inclusive = calculateLine({
      ...LINE,
      discountMinor: 20_00,
      taxMode: "INCLUSIVE",
    });
    expect(inclusive.totalMinor).toBe(80_00);
    expect(inclusive.taxMinor).toBe(13_33);
  });
});

async function seedShop(orgInput?: { taxDisplayMode?: string }) {
  const orgId = randomUUID();
  const locationId = randomUUID();
  const userId = randomUUID();
  const membershipId = randomUUID();
  const roleId = randomUUID();
  const customerId = randomUUID();
  const workOrderId = randomUUID();

  await dbModule.db.$transaction([
    dbModule.db.organization.create({
      data: {
        id: orgId,
        slug: `org-${orgId.slice(0, 8)}`,
        name: "VAT Org",
        ...(orgInput?.taxDisplayMode ? { taxDisplayMode: orgInput.taxDisplayMode } : {}),
      },
    }),
    dbModule.db.location.create({
      data: { id: locationId, organizationId: orgId, code: "MAIN", name: "Main", timeZone: "UTC" },
    }),
    dbModule.db.user.create({
      data: { id: userId, email: `vt-${userId.slice(0, 8)}@example.test`, displayName: "VAT User" },
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
        permissions: ["work_orders.write", "work_orders.read", "invoices.issue"],
      },
    }),
    dbModule.db.membershipRole.create({ data: { organizationId: orgId, membershipId, roleId } }),
    dbModule.db.customer.create({
      data: {
        id: customerId,
        organizationId: orgId,
        kind: "INDIVIDUAL",
        displayName: "VAT Customer",
      },
    }),
    dbModule.db.workOrder.create({
      data: {
        id: workOrderId,
        organizationId: orgId,
        locationId,
        customerId,
        number: "RO-VAT1",
        customerConcern: "vat test",
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
      permissions: new Set(["work_orders.write", "work_orders.read", "invoices.issue"]),
    }) as import("@/modules/tenancy/policy").TenantContext;

  return { orgId, workOrderId, context };
}

describe("VAT-inclusive documents (#195)", { skip: shouldSkip }, () => {
  it("snapshots the org mode on the revision and computes inclusive lines", async () => {
    const estimateService = await import("@/modules/estimates/estimate-service");
    const seed = await seedShop({ taxDisplayMode: "INCLUSIVE" });

    const { revisionId } = await estimateService.createDraftRevision({
      db: dbModule.db,
      context: seed.context(),
      workOrderId: seed.workOrderId,
      currency: "EUR",
    });

    await estimateService.addLine({
      db: dbModule.db,
      context: seed.context(),
      revisionId,
      serviceGroupKey: "labor",
      kind: "LABOR",
      description: "Brake service",
      quantityMilli: 1000,
      unitPriceMinor: 100_00,
      discountMinor: 0,
      taxable: true,
      taxRateBasisPoints: 2000,
      position: 1,
    });

    const line = await dbModule.db.estimateLine.findFirst({
      where: { estimateRevisionId: revisionId },
      select: { taxMinor: true, totalMinor: true },
    });
    // VAT-inclusive: the customer pays 100.00, of which 16.67 is VAT.
    expect(line?.totalMinor).toBe(100_00n);
    expect(line?.taxMinor).toBe(16_67n);

    const revision = await dbModule.db.estimateRevision.findUnique({
      where: { id: revisionId },
      select: { taxInclusive: true },
    });
    expect(revision?.taxInclusive).toBe(true);
  });

  it("keeps documents on their original convention when the org setting flips", async () => {
    const estimateService = await import("@/modules/estimates/estimate-service");
    const seed = await seedShop({ taxDisplayMode: "EXCLUSIVE" });

    const { revisionId } = await estimateService.createDraftRevision({
      db: dbModule.db,
      context: seed.context(),
      workOrderId: seed.workOrderId,
      currency: "USD",
    });

    // The shop switches to VAT-style pricing after the revision was created.
    await dbModule.db.organization.update({
      where: { id: seed.orgId },
      data: { taxDisplayMode: "INCLUSIVE" },
    });

    await estimateService.addLine({
      db: dbModule.db,
      context: seed.context(),
      revisionId,
      serviceGroupKey: "labor",
      kind: "LABOR",
      description: "Still exclusive",
      quantityMilli: 1000,
      unitPriceMinor: 100_00,
      discountMinor: 0,
      taxable: true,
      taxRateBasisPoints: 2000,
      position: 1,
    });

    const line = await dbModule.db.estimateLine.findFirst({
      where: { estimateRevisionId: revisionId },
      select: { taxMinor: true, totalMinor: true },
    });
    // History keeps its convention: tax added on top.
    expect(line?.totalMinor).toBe(120_00n);
    expect(line?.taxMinor).toBe(20_00n);
  });

  it("carries the convention onto the invoice", async () => {
    const estimateService = await import("@/modules/estimates/estimate-service");
    const invoiceService = await import("@/modules/invoices/invoice-service");
    const seed = await seedShop({ taxDisplayMode: "INCLUSIVE" });

    const { revisionId } = await estimateService.createDraftRevision({
      db: dbModule.db,
      context: seed.context(),
      workOrderId: seed.workOrderId,
      currency: "EUR",
    });
    await estimateService.addLine({
      db: dbModule.db,
      context: seed.context(),
      revisionId,
      serviceGroupKey: "labor",
      kind: "LABOR",
      description: "Line",
      quantityMilli: 1000,
      unitPriceMinor: 50_00,
      discountMinor: 0,
      taxable: true,
      taxRateBasisPoints: 2000,
      position: 1,
    });
    await estimateService.presentRevision({
      db: dbModule.db,
      context: seed.context(),
      revisionId,
    });
    // Mark the line as not requiring customer authorization so it flows to
    // the invoice under the APPROVED_ONLY policy without the full
    // authorization-link machinery.
    await dbModule.db.estimateLine.updateMany({
      where: { estimateRevisionId: revisionId },
      data: { authorizationRequired: false },
    });
    await dbModule.db.workOrder.update({
      where: { id: seed.workOrderId },
      data: { status: "COMPLETED" },
    });

    const invoice = await invoiceService.createInvoiceFromWorkOrder({
      db: dbModule.db,
      context: seed.context(),
      workOrderId: seed.workOrderId,
    });

    const row = await dbModule.db.invoice.findUnique({
      where: { id: invoice.invoiceId },
      select: { taxInclusive: true, taxMinor: true, totalMinor: true },
    });
    expect(row?.taxInclusive).toBe(true);
    expect(row?.totalMinor).toBe(50_00n);
    expect(row?.taxMinor).toBe(8_33n);
  });
});
