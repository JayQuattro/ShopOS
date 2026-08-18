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

async function seedApprovedJobWithCreditChangeOrder() {
  const orgId = randomUUID();
  const locationId = randomUUID();
  const userId = randomUUID();
  const membershipId = randomUUID();
  const roleId = randomUUID();
  const customerId = randomUUID();
  const assetId = randomUUID();
  const baselineLaborLineId = randomUUID();

  await dbModule.db.$transaction([
    dbModule.db.organization.create({
      data: { id: orgId, slug: `org-${orgId.slice(0, 8)}`, name: "Credit Inv Org" },
    }),
    dbModule.db.location.create({
      data: { id: locationId, organizationId: orgId, code: "MAIN", name: "Main", timeZone: "UTC" },
    }),
    dbModule.db.user.create({
      data: {
        id: userId,
        email: `c-${userId.slice(0, 8)}@example.test`,
        displayName: "Credit Inv User",
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
          "authorizations.record",
          "invoices.issue",
        ],
      },
    }),
    dbModule.db.membershipRole.create({ data: { organizationId: orgId, membershipId, roleId } }),
    dbModule.db.customer.create({
      data: {
        id: customerId,
        organizationId: orgId,
        kind: "INDIVIDUAL",
        displayName: "Credit Customer",
      },
    }),
    dbModule.db.asset.create({
      data: {
        id: assetId,
        organizationId: orgId,
        customerId,
        displayName: "Credit Car",
        category: "automobile",
      },
    }),
    dbModule.db.workOrder.create({
      data: {
        organizationId: orgId,
        locationId,
        customerId,
        assetId,
        number: "RO-2001",
        customerConcern: "Credit",
        status: "AUTHORIZED",
      },
    }),
  ]);

  const workOrderId = (await dbModule.db.workOrder.findFirst({ where: { organizationId: orgId } }))!
    .id;

  // Approved baseline: $200 labor (no tax for simplicity).
  const baseline = await dbModule.db.estimateRevision.create({
    data: {
      organizationId: orgId,
      locationId,
      workOrderId,
      revisionNumber: 1,
      status: "PRESENTED",
      documentKind: "BASELINE",
      currency: "USD",
      subtotalMinor: 20000n,
      discountMinor: 0n,
      taxMinor: 0n,
      totalMinor: 20000n,
      presentedAt: new Date(),
    },
  });
  await dbModule.db.estimateLine.create({
    data: {
      id: baselineLaborLineId,
      organizationId: orgId,
      estimateRevisionId: baseline.id,
      serviceGroupKey: "brakes",
      kind: "LABOR",
      description: "Baseline labor",
      quantityMilli: 1000,
      unitPriceMinor: 20000n,
      grossMinor: 20000n,
      discountMinor: 0n,
      taxable: false,
      taxRateBasisPoints: 0,
      taxMinor: 0n,
      totalMinor: 20000n,
      position: 1,
    },
  });
  const baselineAuthorization = await dbModule.db.authorization.create({
    data: {
      id: randomUUID(),
      organizationId: orgId,
      estimateRevisionId: baseline.id,
      method: "CUSTOMER_LINK",
      providedByName: "Credit Customer",
      occurredAt: new Date(),
    },
  });
  await dbModule.db.authorizationDecision.create({
    data: {
      authorizationId: baselineAuthorization.id,
      organizationId: orgId,
      estimateLineId: baselineLaborLineId,
      decision: "APPROVED",
    },
  });

  const context = () =>
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
        "authorizations.record",
        "invoices.issue",
      ] as const),
    }) as import("@/modules/tenancy/policy").TenantContext;

  return { orgId, workOrderId, context };
}

describe("invoice credit lines (#169)", { skip: shouldSkip }, () => {
  it("snapshots an approved credit change-order line into the invoice with correct totals", async () => {
    const { createChangeOrder, presentChangeOrder } =
      await import("@/modules/estimates/change-order-service");
    const { createInvoiceFromWorkOrder } = await import("@/modules/invoices/invoice-service");
    const seedData = await seedApprovedJobWithCreditChangeOrder();
    const context = seedData.context();

    // Approved change order whose only line is a credit (part cheaper than quoted).
    const created = await createChangeOrder({
      db: dbModule.db,
      context,
      workOrderId: seedData.workOrderId,
      note: "Part came in cheaper than quoted.",
    });
    const { addLine } = await import("@/modules/estimates/estimate-service");
    await addLine({
      db: dbModule.db,
      context,
      revisionId: created.revisionId,
      kind: "PART",
      serviceGroupKey: "parts",
      description: "Rotor price correction",
      quantityMilli: 1000,
      unitPriceMinor: -4500,
      discountMinor: 0,
      taxable: false,
      taxRateBasisPoints: 0,
      position: 1,
    });
    await presentChangeOrder({ db: dbModule.db, context, revisionId: created.revisionId });

    // Net delta ≤ 0 with the default AUTO_APPLY policy: presentation records
    // the SYSTEM approval itself, so no explicit decision is needed.
    const systemDecision = await dbModule.db.authorizationDecision.findFirst({
      where: { estimateLine: { estimateRevisionId: created.revisionId } },
      include: { authorization: true },
    });
    expect(systemDecision?.decision).toBe("APPROVED");
    expect(systemDecision?.authorization.method).toBe("SYSTEM");

    // Before the fix this violated invoice_lines_values_check (negative gross).
    const invoice = await createInvoiceFromWorkOrder({
      db: dbModule.db,
      context,
      workOrderId: seedData.workOrderId,
    });

    const lines = await dbModule.db.invoiceLine.findMany({
      where: { invoiceId: invoice.invoiceId },
      orderBy: { position: "asc" },
    });
    expect(lines).toHaveLength(2);
    const creditLine = lines.find((line) => line.description === "Rotor price correction");
    expect(creditLine?.grossMinor).toBe(-4500n);
    expect(creditLine?.totalMinor).toBe(-4500n);

    const record = await dbModule.db.invoice.findUnique({ where: { id: invoice.invoiceId } });
    expect(record?.subtotalMinor).toBe(15500n); // 20000 - 4500
    expect(record?.totalMinor).toBe(15500n);
  });
});
