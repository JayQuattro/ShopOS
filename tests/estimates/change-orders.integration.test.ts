import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { assertDedicatedTestDatabase, resetTestDatabase } from "../helpers/database";
import { passQualityCheck } from "@/modules/work-orders/quality-check-service";

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

async function seedAuthorizedWorkOrder(options?: {
  creditPolicy?: "AUTO_APPLY" | "REQUIRE_APPROVAL";
  invoiceLinePolicy?: "APPROVED_ONLY" | "ALL_LINES";
}) {
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
      data: {
        id: orgId,
        slug: `org-${orgId.slice(0, 8)}`,
        name: "CO Org",
        ...(options?.creditPolicy ? { changeOrderCreditPolicy: options.creditPolicy } : {}),
        ...(options?.invoiceLinePolicy ? { invoiceLinePolicy: options.invoiceLinePolicy } : {}),
      },
    }),
    dbModule.db.location.create({
      data: { id: locationId, organizationId: orgId, code: "MAIN", name: "Main", timeZone: "UTC" },
    }),
    dbModule.db.user.create({
      data: { id: userId, email: `u-${userId.slice(0, 8)}@example.test`, displayName: "CO User" },
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
        displayName: "CO Customer",
        primaryEmail: "co-customer@example.test",
      },
    }),
    dbModule.db.asset.create({
      data: {
        id: assetId,
        organizationId: orgId,
        customerId,
        displayName: "CO Car",
        category: "automobile",
      },
    }),
    dbModule.db.workOrder.create({
      data: {
        organizationId: orgId,
        locationId,
        customerId,
        assetId,
        number: "RO-5001",
        customerConcern: "Grinding noise",
        status: "AUTHORIZED",
      },
    }),
  ]);

  // Approved baseline: one approved line of 100.00 + 6% tax = 106.00.
  const baseline = await dbModule.db.estimateRevision.create({
    data: {
      organizationId: orgId,
      locationId,
      workOrderId: (await dbModule.db.workOrder.findFirst({ where: { organizationId: orgId } }))!
        .id,
      revisionNumber: 1,
      status: "PRESENTED",
      documentKind: "BASELINE",
      currency: "USD",
      subtotalMinor: 10000n,
      discountMinor: 0n,
      taxMinor: 600n,
      totalMinor: 10600n,
      presentedAt: new Date(),
      createdByUserId: userId,
    },
  });
  await dbModule.db.estimateLine.create({
    data: {
      id: lineId,
      organizationId: orgId,
      estimateRevisionId: baseline.id,
      serviceGroupKey: "brakes",
      kind: "LABOR",
      description: "Baseline brake service",
      quantityMilli: 1000,
      unitPriceMinor: 10000n,
      grossMinor: 10000n,
      discountMinor: 0n,
      taxable: true,
      taxRateBasisPoints: 600,
      taxMinor: 600n,
      totalMinor: 10600n,
      position: 1,
    },
  });
  const authorization = await dbModule.db.authorization.create({
    data: {
      id: randomUUID(),
      organizationId: orgId,
      estimateRevisionId: baseline.id,
      method: "CUSTOMER_LINK",
      providedByName: "CO Customer",
      occurredAt: new Date(),
    },
  });
  await dbModule.db.authorizationDecision.create({
    data: {
      authorizationId: authorization.id,
      organizationId: orgId,
      estimateLineId: lineId,
      decision: "APPROVED",
    },
  });

  const wo = await dbModule.db.workOrder.findFirst({ where: { organizationId: orgId } });

  return {
    orgId,
    locationId,
    workOrderId: wo!.id,
    baselineRevisionId: baseline.id,
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
          "authorizations.record",
          "invoices.issue",
        ] as const),
      }) as import("@/modules/tenancy/policy").TenantContext,
  };
}

async function addChangeOrderLine(
  seed: Awaited<ReturnType<typeof seedAuthorizedWorkOrder>>,
  revisionId: string,
  overrides: Partial<{ description: string; unitPriceMinor: number }> = {},
) {
  const { addLine } = await import("@/modules/estimates/estimate-service");
  await addLine({
    db: dbModule.db,
    context: seed.context(),
    revisionId,
    kind: "PART",
    serviceGroupKey: "brakes",
    description: overrides.description ?? "Rotor replacement",
    quantityMilli: 1000,
    unitPriceMinor: overrides.unitPriceMinor ?? 20000,
    discountMinor: 0,
    taxable: true,
    taxRateBasisPoints: 600,
    position: 1,
  });
}

describe("change orders (#129, ADR 0014)", { skip: shouldSkip }, () => {
  it("creates a change order on an authorized work order and presents it for approval", async () => {
    const { createChangeOrder, presentChangeOrder } =
      await import("@/modules/estimates/change-order-service");
    const seed = await seedAuthorizedWorkOrder();
    const context = seed.context();

    const created = await createChangeOrder({
      db: dbModule.db,
      context,
      workOrderId: seed.workOrderId,
      note: "Rotors scored beyond spec during brake service.",
    });
    expect(created.changeOrderNumber).toBe(1);

    await addChangeOrderLine(seed, created.revisionId);

    const presented = await presentChangeOrder({
      db: dbModule.db,
      context,
      revisionId: created.revisionId,
    });
    expect(presented.autoApplied).toBe(false);

    const revision = await dbModule.db.estimateRevision.findUnique({
      where: { id: created.revisionId },
    });
    expect(revision?.status).toBe("PRESENTED");
    expect(revision?.documentKind).toBe("CHANGE_ORDER");

    // Work-order status untouched by change orders.
    const wo = await dbModule.db.workOrder.findUnique({ where: { id: seed.workOrderId } });
    expect(wo?.status).toBe("AUTHORIZED");

    // Link issued and customer notification enqueued.
    const link = await dbModule.db.authorizationLink.findFirst({
      where: { estimateRevisionId: created.revisionId, revokedAt: null },
    });
    expect(link).not.toBeNull();
    const event = await dbModule.db.outboxEvent.findFirst({
      where: { organizationId: seed.orgId, aggregateId: created.revisionId },
    });
    expect(event?.eventType).toBe("estimate.presented");
  });

  it("rejects a change order while the work order is not authorized", async () => {
    const { createChangeOrder } = await import("@/modules/estimates/change-order-service");
    const seed = await seedAuthorizedWorkOrder();
    await dbModule.db.workOrder.update({
      where: { id: seed.workOrderId },
      data: { status: "ESTIMATING" },
    });
    await expect(
      createChangeOrder({
        db: dbModule.db,
        context: seed.context(),
        workOrderId: seed.workOrderId,
        note: "Should not be allowed.",
      }),
    ).rejects.toMatchObject({ reason: "work_order_not_authorized" });
  });

  it("enforces one pending change order per work order", async () => {
    const { createChangeOrder } = await import("@/modules/estimates/change-order-service");
    const seed = await seedAuthorizedWorkOrder();
    const context = seed.context();
    const first = await createChangeOrder({
      db: dbModule.db,
      context,
      workOrderId: seed.workOrderId,
      note: "First discovery.",
    });
    await addChangeOrderLine(seed, first.revisionId);
    const { presentChangeOrder } = await import("@/modules/estimates/change-order-service");
    await presentChangeOrder({ db: dbModule.db, context, revisionId: first.revisionId });

    await expect(
      createChangeOrder({
        db: dbModule.db,
        context,
        workOrderId: seed.workOrderId,
        note: "Second discovery.",
      }),
    ).rejects.toMatchObject({ reason: "change_order_pending_exists" });
  });

  it("auto-applies credit change orders under the default policy", async () => {
    const { createChangeOrder, presentChangeOrder } =
      await import("@/modules/estimates/change-order-service");
    const seed = await seedAuthorizedWorkOrder();
    const context = seed.context();

    const created = await createChangeOrder({
      db: dbModule.db,
      context,
      workOrderId: seed.workOrderId,
      note: "Part came in cheaper than quoted.",
    });
    await addChangeOrderLine(seed, created.revisionId, { unitPriceMinor: -4500 });

    const presented = await presentChangeOrder({
      db: dbModule.db,
      context,
      revisionId: created.revisionId,
    });
    expect(presented.autoApplied).toBe(true);

    // SYSTEM authorization approving every line; no customer link.
    const decision = await dbModule.db.authorizationDecision.findFirst({
      where: { estimateLine: { estimateRevisionId: created.revisionId } },
      include: { authorization: true },
    });
    expect(decision?.decision).toBe("APPROVED");
    expect(decision?.authorization.method).toBe("SYSTEM");
    const link = await dbModule.db.authorizationLink.findFirst({
      where: { estimateRevisionId: created.revisionId },
    });
    expect(link).toBeNull();
  });

  it("requires approval for credit change orders under REQUIRE_APPROVAL", async () => {
    const { createChangeOrder, presentChangeOrder } =
      await import("@/modules/estimates/change-order-service");
    const seed = await seedAuthorizedWorkOrder({ creditPolicy: "REQUIRE_APPROVAL" });
    const context = seed.context();

    const created = await createChangeOrder({
      db: dbModule.db,
      context,
      workOrderId: seed.workOrderId,
      note: "Goodwill price reduction pending customer sign-off.",
    });
    await addChangeOrderLine(seed, created.revisionId, { unitPriceMinor: -3000 });

    const presented = await presentChangeOrder({
      db: dbModule.db,
      context,
      revisionId: created.revisionId,
    });
    expect(presented.autoApplied).toBe(false);
    const link = await dbModule.db.authorizationLink.findFirst({
      where: { estimateRevisionId: created.revisionId, revokedAt: null },
    });
    expect(link).not.toBeNull();
  });

  it("rejects credit lines on baseline revisions", async () => {
    const { createDraftRevision, addLine } = await import("@/modules/estimates/estimate-service");
    const seed = await seedAuthorizedWorkOrder();
    const { revisionId } = await createDraftRevision({
      db: dbModule.db,
      context: seed.context(),
      workOrderId: seed.workOrderId,
      currency: "USD",
    });
    await expect(
      addLine({
        db: dbModule.db,
        context: seed.context(),
        revisionId,
        kind: "PART",
        serviceGroupKey: "brakes",
        description: "Illegal credit",
        quantityMilli: 1000,
        unitPriceMinor: -1000,
        discountMinor: 0,
        taxable: false,
        taxRateBasisPoints: 0,
        position: 1,
      }),
    ).rejects.toMatchObject({ reason: "credit_line_not_allowed" });
  });

  it("voids an undecided change order and revokes its links", async () => {
    const { createChangeOrder, presentChangeOrder, voidChangeOrder } =
      await import("@/modules/estimates/change-order-service");
    const seed = await seedAuthorizedWorkOrder();
    const context = seed.context();
    const created = await createChangeOrder({
      db: dbModule.db,
      context,
      workOrderId: seed.workOrderId,
      note: "Mistaken entry.",
    });
    await addChangeOrderLine(seed, created.revisionId);
    await presentChangeOrder({ db: dbModule.db, context, revisionId: created.revisionId });

    await voidChangeOrder({ db: dbModule.db, context, revisionId: created.revisionId });

    const revision = await dbModule.db.estimateRevision.findUnique({
      where: { id: created.revisionId },
    });
    expect(revision?.status).toBe("VOIDED");
    const link = await dbModule.db.authorizationLink.findFirst({
      where: { estimateRevisionId: created.revisionId },
    });
    expect(link?.revokedAt).not.toBeNull();
  });

  it("blocks completion and invoicing while a change order is pending", async () => {
    const { createChangeOrder, presentChangeOrder } =
      await import("@/modules/estimates/change-order-service");
    const { transitionStatus } = await import("@/modules/work-orders/work-order-service");
    const { createInvoiceFromWorkOrder } = await import("@/modules/invoices/invoice-service");
    const { recordAuthorization } = await import("@/modules/estimates/authorization-service");
    const seed = await seedAuthorizedWorkOrder();
    const context = seed.context();

    await transitionStatus({
      db: dbModule.db,
      context,
      workOrderId: seed.workOrderId,
      targetStatus: "IN_PROGRESS",
    });

    const created = await createChangeOrder({
      db: dbModule.db,
      context,
      workOrderId: seed.workOrderId,
      note: "Additional work found.",
    });
    await addChangeOrderLine(seed, created.revisionId);
    await presentChangeOrder({ db: dbModule.db, context, revisionId: created.revisionId });

    await expect(
      transitionStatus({
        db: dbModule.db,
        context,
        workOrderId: seed.workOrderId,
        targetStatus: "COMPLETED",
      }),
    ).rejects.toMatchObject({ reason: "quality_check_required" });
    await passQualityCheck({
      db: dbModule.db,
      context,
      workOrderId: seed.workOrderId,
    });
    await expect(
      transitionStatus({
        db: dbModule.db,
        context,
        workOrderId: seed.workOrderId,
        targetStatus: "COMPLETED",
      }),
    ).rejects.toMatchObject({ reason: "change_order_pending" });

    await expect(
      createInvoiceFromWorkOrder({ db: dbModule.db, context, workOrderId: seed.workOrderId }),
    ).rejects.toMatchObject({ reason: "change_order_pending" });

    // Customer approves the delta; work unblocks.
    const lines = await dbModule.db.estimateLine.findMany({
      where: { estimateRevisionId: created.revisionId },
    });
    await recordAuthorization({
      db: dbModule.db,
      context,
      revisionId: created.revisionId,
      method: "PHONE",
      providedByName: "CO Customer",
      decisions: lines.map((line) => ({ estimateLineId: line.id, decision: "APPROVED" as const })),
    });

    await transitionStatus({
      db: dbModule.db,
      context,
      workOrderId: seed.workOrderId,
      targetStatus: "COMPLETED",
    });
    const invoice = await createInvoiceFromWorkOrder({
      db: dbModule.db,
      context,
      workOrderId: seed.workOrderId,
    });
    expect(invoice.number).toMatch(/^INV-\d+$/);
  });

  it("computes cumulative authorized totals across baseline and change orders", async () => {
    const { createChangeOrder, presentChangeOrder, getAuthorizedTotals } =
      await import("@/modules/estimates/change-order-service");
    const { recordAuthorization } = await import("@/modules/estimates/authorization-service");
    const seed = await seedAuthorizedWorkOrder();
    const context = seed.context();

    const before = await getAuthorizedTotals(dbModule.db, {
      organizationId: seed.orgId,
      workOrderId: seed.workOrderId,
    });
    expect(before?.baselineApprovedMinor).toBe(10600);
    expect(before?.cumulativeApprovedMinor).toBe(10600);

    const created = await createChangeOrder({
      db: dbModule.db,
      context,
      workOrderId: seed.workOrderId,
      note: "Rotor replacement needed.",
    });
    // Two lines: one approved (200.00 + tax = 212.00), one declined.
    const { addLine } = await import("@/modules/estimates/estimate-service");
    await addLine({
      db: dbModule.db,
      context,
      revisionId: created.revisionId,
      kind: "PART",
      serviceGroupKey: "brakes",
      description: "Rotor",
      quantityMilli: 1000,
      unitPriceMinor: 20000,
      discountMinor: 0,
      taxable: true,
      taxRateBasisPoints: 600,
      position: 1,
    });
    await addLine({
      db: dbModule.db,
      context,
      revisionId: created.revisionId,
      kind: "FEE",
      serviceGroupKey: "misc",
      description: "Optional coating",
      quantityMilli: 1000,
      unitPriceMinor: 5000,
      discountMinor: 0,
      taxable: false,
      taxRateBasisPoints: 0,
      position: 2,
    });
    await presentChangeOrder({ db: dbModule.db, context, revisionId: created.revisionId });

    const lines = await dbModule.db.estimateLine.findMany({
      where: { estimateRevisionId: created.revisionId },
      orderBy: { position: "asc" },
    });
    await recordAuthorization({
      db: dbModule.db,
      context,
      revisionId: created.revisionId,
      method: "IN_PERSON",
      providedByName: "CO Customer",
      decisions: [
        { estimateLineId: lines[0]!.id, decision: "APPROVED" as const },
        { estimateLineId: lines[1]!.id, decision: "DECLINED" as const },
      ],
    });

    const after = await getAuthorizedTotals(dbModule.db, {
      organizationId: seed.orgId,
      workOrderId: seed.workOrderId,
    });
    expect(after?.baselineApprovedMinor).toBe(10600);
    expect(after?.changeOrdersApprovedMinor).toBe(21200);
    expect(after?.cumulativeApprovedMinor).toBe(31800);
  });

  it("invoices the approved union and excludes declined lines under the default policy", async () => {
    const { createChangeOrder, presentChangeOrder } =
      await import("@/modules/estimates/change-order-service");
    const { recordAuthorization } = await import("@/modules/estimates/authorization-service");
    const { createInvoiceFromWorkOrder } = await import("@/modules/invoices/invoice-service");
    const seed = await seedAuthorizedWorkOrder();
    const context = seed.context();

    const created = await createChangeOrder({
      db: dbModule.db,
      context,
      workOrderId: seed.workOrderId,
      note: "Rotor replacement needed.",
    });
    await addChangeOrderLine(seed, created.revisionId);
    await presentChangeOrder({ db: dbModule.db, context, revisionId: created.revisionId });

    const lines = await dbModule.db.estimateLine.findMany({
      where: { estimateRevisionId: created.revisionId },
    });
    await recordAuthorization({
      db: dbModule.db,
      context,
      revisionId: created.revisionId,
      method: "PHONE",
      providedByName: "CO Customer",
      decisions: lines.map((line) => ({ estimateLineId: line.id, decision: "DECLINED" as const })),
    });

    const result = await createInvoiceFromWorkOrder({
      db: dbModule.db,
      context,
      workOrderId: seed.workOrderId,
    });
    const invoice = await dbModule.db.invoice.findUnique({
      where: { id: result.invoiceId },
      include: { lines: true },
    });
    // Baseline approved line only; the declined change-order line is excluded.
    expect(invoice?.lines).toHaveLength(1);
    expect(invoice?.lines[0]?.description).toBe("Baseline brake service");
    expect(invoice?.totalMinor).toBe(10600n);
  });

  it("invoices all lines across the union under ALL_LINES policy", async () => {
    const { createChangeOrder, presentChangeOrder } =
      await import("@/modules/estimates/change-order-service");
    const { recordAuthorization } = await import("@/modules/estimates/authorization-service");
    const { createInvoiceFromWorkOrder } = await import("@/modules/invoices/invoice-service");
    const seed = await seedAuthorizedWorkOrder({ invoiceLinePolicy: "ALL_LINES" });
    const context = seed.context();

    const created = await createChangeOrder({
      db: dbModule.db,
      context,
      workOrderId: seed.workOrderId,
      note: "Additional rotor replacement.",
    });
    await addChangeOrderLine(seed, created.revisionId);
    await presentChangeOrder({ db: dbModule.db, context, revisionId: created.revisionId });

    // The pending guard is policy-independent: resolve the change order first.
    const lines = await dbModule.db.estimateLine.findMany({
      where: { estimateRevisionId: created.revisionId },
    });
    await recordAuthorization({
      db: dbModule.db,
      context,
      revisionId: created.revisionId,
      method: "PHONE",
      providedByName: "CO Customer",
      decisions: lines.map((line) => ({ estimateLineId: line.id, decision: "APPROVED" as const })),
    });

    const result = await createInvoiceFromWorkOrder({
      db: dbModule.db,
      context,
      workOrderId: seed.workOrderId,
    });
    const invoice = await dbModule.db.invoice.findUnique({
      where: { id: result.invoiceId },
      include: { lines: true },
    });
    expect(invoice?.lines).toHaveLength(2);
    expect(invoice?.totalMinor).toBe(10600n + 21200n);
  });

  it("prevents superseding a decided revision", async () => {
    const { supersedeRevision } = await import("@/modules/estimates/estimate-service");
    const seed = await seedAuthorizedWorkOrder();
    await expect(
      supersedeRevision({
        db: dbModule.db,
        context: seed.context(),
        revisionId: seed.baselineRevisionId,
      }),
    ).rejects.toMatchObject({ reason: "revision_decided" });
  });

  it("returns cumulative context on the customer authorization link", async () => {
    const { createChangeOrder, presentChangeOrder } =
      await import("@/modules/estimates/change-order-service");
    const { validateAuthorizationLink } =
      await import("@/modules/estimates/authorization-link-service");
    const seed = await seedAuthorizedWorkOrder();
    const context = seed.context();

    const created = await createChangeOrder({
      db: dbModule.db,
      context,
      workOrderId: seed.workOrderId,
      note: "Rotor replacement needed.",
    });
    await addChangeOrderLine(seed, created.revisionId);
    await presentChangeOrder({ db: dbModule.db, context, revisionId: created.revisionId });

    const link = await dbModule.db.authorizationLink.findFirst({
      where: { estimateRevisionId: created.revisionId, revokedAt: null },
    });
    const view = await validateAuthorizationLink(dbModule.db, link!.token);
    expect(view.documentKind).toBe("CHANGE_ORDER");
    expect(view.changeOrderNumber).toBe(1);
    expect(view.summaryNote).toContain("Rotor");
    expect(view.previouslyApprovedMinor).toBe("10600");
  });

  it("denies cross-organization change order operations", async () => {
    const { createChangeOrder } = await import("@/modules/estimates/change-order-service");
    const seedA = await seedAuthorizedWorkOrder();
    const seedB = await seedAuthorizedWorkOrder();
    // Actor from org B attempts to create a change order on org A's work order.
    await expect(
      createChangeOrder({
        db: dbModule.db,
        context: seedB.context(),
        workOrderId: seedA.workOrderId,
        note: "Cross-tenant attempt.",
      }),
    ).rejects.toMatchObject({ reason: "work_order_not_found" });
  });
});
