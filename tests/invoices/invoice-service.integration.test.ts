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

beforeEach(async () => {
  if (!RUN) return;
  await resetTestDatabase(dbModule.db);
});

async function seedWorkOrderWithEstimate() {
  const orgId = randomUUID();
  const locationId = randomUUID();
  const userId = randomUUID();
  const membershipId = randomUUID();
  const roleId = randomUUID();
  const customerId = randomUUID();
  const assetId = randomUUID();

  await dbModule.db.$transaction([
    dbModule.db.organization.create({
      data: { id: orgId, slug: `org-${orgId.slice(0, 8)}`, name: "Inv Org" },
    }),
    dbModule.db.location.create({
      data: { id: locationId, organizationId: orgId, code: "MAIN", name: "Main", timeZone: "UTC" },
    }),
    dbModule.db.user.create({
      data: { id: userId, email: `u-${userId.slice(0, 8)}@example.test`, displayName: "Inv User" },
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
          "payments.record",
        ],
      },
    }),
    dbModule.db.membershipRole.create({ data: { organizationId: orgId, membershipId, roleId } }),
    dbModule.db.customer.create({
      data: {
        id: customerId,
        organizationId: orgId,
        kind: "INDIVIDUAL",
        displayName: "Inv Customer",
      },
    }),
    dbModule.db.asset.create({
      data: {
        id: assetId,
        organizationId: orgId,
        customerId,
        displayName: "Inv Car",
        category: "automobile",
      },
    }),
  ]);

  const wo = await dbModule.db.workOrder.create({
    data: {
      organizationId: orgId,
      locationId,
      customerId,
      assetId,
      number: "RO-4001",
      customerConcern: "Test",
      status: "COMPLETED",
    },
  });

  const revision = await dbModule.db.estimateRevision.create({
    data: {
      organizationId: orgId,
      locationId,
      workOrderId: wo.id,
      revisionNumber: 1,
      status: "PRESENTED",
      currency: "USD",
      subtotalMinor: 40000n,
      discountMinor: 0n,
      taxMinor: 2880n,
      totalMinor: 42880n,
      presentedAt: new Date(),
      createdByUserId: userId,
    },
  });

  await dbModule.db.estimateLine.create({
    data: {
      organizationId: orgId,
      estimateRevisionId: revision.id,
      serviceGroupKey: "brakes",
      kind: "LABOR",
      description: "Brake job",
      quantityMilli: 2500,
      unitPriceMinor: 16000n,
      grossMinor: 40000n,
      discountMinor: 0n,
      taxable: true,
      taxRateBasisPoints: 720,
      taxMinor: 2880n,
      totalMinor: 42880n,
      position: 1,
    },
  });

  return {
    orgId,
    workOrderId: wo.id,
    revisionId: revision.id,
    locationId,
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
          "invoices.issue",
          "payments.record",
        ] as const),
      }) as import("@/modules/tenancy/policy").TenantContext,
  };
}

describe("invoice + payment service (#20)", { skip: shouldSkip }, () => {
  it("creates an invoice from a completed work order, snapshots estimate lines", async () => {
    const { createInvoiceFromWorkOrder } = await import("@/modules/invoices/invoice-service");
    const seed = await seedWorkOrderWithEstimate();
    const result = await createInvoiceFromWorkOrder({
      db: dbModule.db,
      context: seed.context(),
      workOrderId: seed.workOrderId,
    });
    expect(result.number).toMatch(/^INV-\d+$/);

    const invoice = await dbModule.db.invoice.findUnique({
      where: { id: result.invoiceId },
      include: { lines: true },
    });
    expect(invoice?.status).toBe("DRAFT");
    expect(invoice?.totalMinor).toBe(42880n);
    expect(invoice?.lines).toHaveLength(1);
    expect(invoice?.lines[0]?.description).toBe("Brake job");
  });

  it("prevents creating a second invoice for the same work order", async () => {
    const { createInvoiceFromWorkOrder } = await import("@/modules/invoices/invoice-service");
    const seed = await seedWorkOrderWithEstimate();
    const context = seed.context();
    await createInvoiceFromWorkOrder({ db: dbModule.db, context, workOrderId: seed.workOrderId });

    await expect(
      createInvoiceFromWorkOrder({ db: dbModule.db, context, workOrderId: seed.workOrderId }),
    ).rejects.toMatchObject({ reason: "invoice_already_exists" });
  });

  it("issues an invoice and records a full payment", async () => {
    const { createInvoiceFromWorkOrder, issueInvoice, recordPayment } =
      await import("@/modules/invoices/invoice-service");
    const seed = await seedWorkOrderWithEstimate();
    const context = seed.context();

    const { invoiceId } = await createInvoiceFromWorkOrder({
      db: dbModule.db,
      context,
      workOrderId: seed.workOrderId,
    });
    await issueInvoice({ db: dbModule.db, context, invoiceId });

    const result = await recordPayment({
      db: dbModule.db,
      context,
      invoiceId,
      amountMinor: 42880,
      method: "CASH",
    });
    expect(result.invoiceStatus).toBe("PAID");

    const invoice = await dbModule.db.invoice.findUnique({
      where: { id: invoiceId },
      select: { status: true, paidMinor: true },
    });
    expect(invoice?.status).toBe("PAID");
    expect(invoice?.paidMinor).toBe(42880n);
  });

  it("records a partial payment and shows PARTIALLY_PAID", async () => {
    const { createInvoiceFromWorkOrder, issueInvoice, recordPayment } =
      await import("@/modules/invoices/invoice-service");
    const seed = await seedWorkOrderWithEstimate();
    const context = seed.context();

    const { invoiceId } = await createInvoiceFromWorkOrder({
      db: dbModule.db,
      context,
      workOrderId: seed.workOrderId,
    });
    await issueInvoice({ db: dbModule.db, context, invoiceId });

    const result = await recordPayment({
      db: dbModule.db,
      context,
      invoiceId,
      amountMinor: 20000,
      method: "CHECK",
    });
    expect(result.invoiceStatus).toBe("PARTIALLY_PAID");
  });

  it("rejects payment exceeding balance", async () => {
    const { createInvoiceFromWorkOrder, issueInvoice, recordPayment } =
      await import("@/modules/invoices/invoice-service");
    const seed = await seedWorkOrderWithEstimate();
    const context = seed.context();

    const { invoiceId } = await createInvoiceFromWorkOrder({
      db: dbModule.db,
      context,
      workOrderId: seed.workOrderId,
    });
    await issueInvoice({ db: dbModule.db, context, invoiceId });

    await expect(
      recordPayment({ db: dbModule.db, context, invoiceId, amountMinor: 999999, method: "CASH" }),
    ).rejects.toMatchObject({ reason: "payment_exceeds_balance" });
  });

  it("rejects payment on an unissued (DRAFT) invoice", async () => {
    const { createInvoiceFromWorkOrder, recordPayment } =
      await import("@/modules/invoices/invoice-service");
    const seed = await seedWorkOrderWithEstimate();
    const context = seed.context();

    const { invoiceId } = await createInvoiceFromWorkOrder({
      db: dbModule.db,
      context,
      workOrderId: seed.workOrderId,
    });

    await expect(
      recordPayment({ db: dbModule.db, context, invoiceId, amountMinor: 100, method: "CASH" }),
    ).rejects.toMatchObject({ reason: "invoice_not_issued" });
  });
});
