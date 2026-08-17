import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { assertDedicatedTestDatabase, resetTestDatabase } from "../helpers/database";
import { passQualityCheck } from "@/modules/work-orders/quality-check-service";

/**
 * Full workflow integration test: the complete customer-to-payment pipeline.
 *
 * Exercises every service in sequence against a real PostgreSQL database:
 * customer + contact + address → asset → work order → estimate revision with
 * lines → present → record authorization → transition to IN_PROGRESS →
 * COMPLETED → create invoice → issue → record partial + full payment →
 * work order auto-closes.
 *
 * Also verifies: activity events at each step, audit trail, enforcement
 * (can't skip states), and cross-tenant isolation at the end.
 */

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

describe("full customer-to-payment workflow", { skip: shouldSkip }, () => {
  it("runs the complete pipeline end-to-end", async () => {
    // === IMPORT ALL SERVICES ===
    const { CustomerRepository } = await import("@/modules/customers/customer-repository");
    const { addContact, addAddress } = await import("@/modules/customers/customer-service");
    const { AssetRepository } = await import("@/modules/assets/asset-repository");
    const { WorkOrderRepository } = await import("@/modules/work-orders/work-order-repository");
    const { transitionStatus } = await import("@/modules/work-orders/work-order-service");
    const { createDraftRevision, addLine, presentRevision } =
      await import("@/modules/estimates/estimate-service");
    const { recordAuthorization } = await import("@/modules/estimates/authorization-service");
    const { createInvoiceFromWorkOrder, issueInvoice, recordPayment } =
      await import("@/modules/invoices/invoice-service");

    // === SEED: org, user, membership, role ===
    const orgId = randomUUID();
    const locationId = randomUUID();
    const userId = randomUUID();
    const membershipId = randomUUID();
    const roleId = randomUUID();

    await dbModule.db.$transaction([
      dbModule.db.organization.create({
        data: { id: orgId, slug: `wf-${orgId.slice(0, 8)}`, name: "Workflow Org" },
      }),
      dbModule.db.location.create({
        data: {
          id: locationId,
          organizationId: orgId,
          code: "MAIN",
          name: "Main Shop",
          timeZone: "UTC",
        },
      }),
      dbModule.db.user.create({
        data: {
          id: userId,
          email: `wf-${userId.slice(0, 8)}@example.test`,
          displayName: "Workflow User",
          emailVerified: true,
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
            "customers.read",
            "customers.write",
            "assets.read",
            "assets.write",
            "work_orders.read",
            "work_orders.write",
            "estimates.present",
            "authorizations.record",
            "invoices.issue",
            "payments.record",
          ],
        },
      }),
      dbModule.db.membershipRole.create({
        data: { organizationId: orgId, membershipId, roleId },
      }),
    ]);

    const context = {
      actorId: userId,
      organizationId: orgId,
      membershipId,
      requestId: randomUUID(),
      organizationWideLocationAccess: true,
      allowedLocationIds: new Set<string>(),
      permissions: new Set([
        "customers.read",
        "customers.write",
        "assets.read",
        "assets.write",
        "work_orders.read",
        "work_orders.write",
        "estimates.present",
        "authorizations.record",
        "invoices.issue",
        "payments.record",
      ] as const),
    } as import("@/modules/tenancy/policy").TenantContext;

    // === STEP 1: Create customer with contact and address ===
    const customerRepo = new CustomerRepository({ db: dbModule.db, context });
    const customer = await customerRepo.create({
      kind: "BUSINESS",
      displayName: "Fleet Services Inc",
      primaryEmail: "dispatch@fleet.example.test",
    });
    expect(customer.id).toBeTruthy();

    const contactResult = await addContact({
      db: dbModule.db,
      context,
      customerId: customer.id,
      name: "Fleet Manager",
      role: "Dispatch",
      email: "dispatch@fleet.example.test",
      isPrimary: true,
    });
    expect(contactResult.contactId).toBeTruthy();

    const addressResult = await addAddress({
      db: dbModule.db,
      context,
      customerId: customer.id,
      label: "HQ",
      line1: "100 Depot Dr",
      city: "Durham",
      stateProvince: "NC",
      isPrimary: true,
    });
    expect(addressResult.addressId).toBeTruthy();

    // === STEP 2: Create asset ===
    const assetRepo = new AssetRepository({ db: dbModule.db, context });
    const asset = await assetRepo.create({
      customerId: customer.id,
      displayName: "2022 Ford F-250",
      category: "automobile",
      manufacturer: "Ford",
      model: "F-250",
      modelYear: 2022,
    });
    await assetRepo.setAutomotiveProfile(asset.id, { vin: "1FT7W2BTXNEC00001" });
    expect(asset.id).toBeTruthy();

    // === STEP 3: Create work order ===
    const woRepo = new WorkOrderRepository({ db: dbModule.db, context });
    const workOrder = await woRepo.create({
      customerId: customer.id,
      assetId: asset.id,
      locationId,
      customerConcern: "Front brake grinding and vibration at highway speed.",
    });
    expect(workOrder.status).toBe("DRAFT");
    expect(workOrder.number).toMatch(/^RO-\d+$/);

    // === STEP 4: Transition to ESTIMATING ===
    await transitionStatus({
      db: dbModule.db,
      context,
      workOrderId: workOrder.id,
      targetStatus: "ESTIMATING",
    });

    // === STEP 5: Create estimate revision with lines ===
    const revision = await createDraftRevision({
      db: dbModule.db,
      context,
      workOrderId: workOrder.id,
      currency: "USD",
    });
    expect(revision.revisionNumber).toBe(1);

    await addLine({
      db: dbModule.db,
      context,
      revisionId: revision.revisionId,
      kind: "LABOR",
      serviceGroupKey: "brakes",
      description: "Replace front brake pads and rotors",
      quantityMilli: 2500,
      unitPriceMinor: 16000,
      discountMinor: 0,
      taxable: true,
      taxRateBasisPoints: 720,
      position: 1,
    });
    await addLine({
      db: dbModule.db,
      context,
      revisionId: revision.revisionId,
      kind: "PART",
      serviceGroupKey: "brakes",
      description: "Front brake pad and rotor kit",
      quantityMilli: 1000,
      unitPriceMinor: 35000,
      discountMinor: 5000,
      taxable: true,
      taxRateBasisPoints: 720,
      position: 2,
    });

    // === STEP 6: Present the estimate (enforcement: allows AWAITING_AUTHORIZATION) ===
    await presentRevision({ db: dbModule.db, context, revisionId: revision.revisionId });

    const presentedRev = await dbModule.db.estimateRevision.findUnique({
      where: { id: revision.revisionId },
      select: { status: true, subtotalMinor: true, totalMinor: true },
    });
    expect(presentedRev?.status).toBe("PRESENTED");
    expect(Number(presentedRev?.subtotalMinor)).toBe(75000); // 40,000 + 35,000

    // Work order should now be AWAITING_AUTHORIZATION (presentRevision transitions it).
    const woAfterPresent = await woRepo.findById(workOrder.id);
    expect(woAfterPresent?.status).toBe("AWAITING_AUTHORIZATION");

    // === STEP 7: Enforcement — can't go to AUTHORIZED without approval ===
    await expect(
      transitionStatus({
        db: dbModule.db,
        context,
        workOrderId: workOrder.id,
        targetStatus: "AUTHORIZED",
      }),
    ).rejects.toMatchObject({ reason: "authorization_required" });

    // === STEP 8: Record authorization (approve both lines) ===
    const lines = await dbModule.db.estimateLine.findMany({
      where: { estimateRevisionId: revision.revisionId },
      select: { id: true },
    });
    expect(lines).toHaveLength(2);

    const authResult = await recordAuthorization({
      db: dbModule.db,
      context,
      revisionId: revision.revisionId,
      method: "IN_PERSON",
      providedByName: "Fleet Manager",
      decisions: lines.map((l) => ({ estimateLineId: l.id, decision: "APPROVED" as const })),
    });
    expect(authResult.authorizationId).toBeTruthy();

    // Work order should be AUTHORIZED (recordAuthorization transitions it).
    const woAfterAuth = await woRepo.findById(workOrder.id);
    expect(woAfterAuth?.status).toBe("AUTHORIZED");

    // === STEP 9: Transition IN_PROGRESS → COMPLETED ===
    await transitionStatus({
      db: dbModule.db,
      context,
      workOrderId: workOrder.id,
      targetStatus: "IN_PROGRESS",
    });
    await passQualityCheck({
      db: dbModule.db,
      context,
      workOrderId: workOrder.id,
    });
    await transitionStatus({
      db: dbModule.db,
      context,
      workOrderId: workOrder.id,
      targetStatus: "COMPLETED",
    });

    // === STEP 10: Create invoice from work order ===
    const invoiceResult = await createInvoiceFromWorkOrder({
      db: dbModule.db,
      context,
      workOrderId: workOrder.id,
    });
    expect(invoiceResult.number).toMatch(/^INV-\d+$/);

    // === STEP 11: Issue the invoice ===
    await issueInvoice({ db: dbModule.db, context, invoiceId: invoiceResult.invoiceId });

    // Work order should be INVOICED.
    const woAfterInvoice = await woRepo.findById(workOrder.id);
    expect(woAfterInvoice?.status).toBe("INVOICED");

    // === STEP 12: Partial payment ===
    const partialResult = await recordPayment({
      db: dbModule.db,
      context,
      invoiceId: invoiceResult.invoiceId,
      amountMinor: 30000,
      method: "CASH",
    });
    expect(partialResult.invoiceStatus).toBe("PARTIALLY_PAID");

    // === STEP 13: Full payment (balance) ===
    const invoice = await dbModule.db.invoice.findUnique({
      where: { id: invoiceResult.invoiceId },
      select: { totalMinor: true, paidMinor: true },
    });
    const balance = Number(invoice?.totalMinor) - Number(invoice?.paidMinor);
    expect(balance).toBeGreaterThan(30000); // more than what's been paid

    const fullResult = await recordPayment({
      db: dbModule.db,
      context,
      invoiceId: invoiceResult.invoiceId,
      amountMinor: balance,
      method: "CARD_EXTERNAL",
    });
    expect(fullResult.invoiceStatus).toBe("PAID");

    // === STEP 14: Work order should auto-close ===
    const woFinal = await woRepo.findById(workOrder.id);
    expect(woFinal?.status).toBe("CLOSED");
    expect(woFinal?.completedAt).toBeTruthy();

    // === STEP 15: Verify activity trail ===
    const activity = await dbModule.db.activityEvent.findMany({
      where: { workOrderId: workOrder.id },
      orderBy: { occurredAt: "asc" },
      select: { eventType: true },
    });
    const eventTypes = activity.map((a) => a.eventType);
    expect(eventTypes).toContain("work_order.created");
    expect(eventTypes).toContain("work_order.status_changed");
    expect(eventTypes).toContain("estimate.presented");
    expect(eventTypes).toContain("authorization.recorded");
    expect(eventTypes).toContain("invoice.created");
    expect(eventTypes).toContain("payment.recorded");

    // === STEP 16: Verify audit trail ===
    const auditCount = await dbModule.db.auditEvent.count({
      where: { organizationId: orgId },
    });
    expect(auditCount).toBeGreaterThanOrEqual(3); // transitions, estimate, auth, invoice

    // === STEP 17: Cross-tenant isolation ===
    // Create a second org and try to access the first org's data.
    const orgBId = randomUUID();
    const userBId = randomUUID();
    await dbModule.db.$transaction([
      dbModule.db.organization.create({
        data: { id: orgBId, slug: `orgb-${orgBId.slice(0, 8)}`, name: "Org B" },
      }),
      dbModule.db.user.create({
        data: {
          id: userBId,
          email: `b-${userBId.slice(0, 8)}@example.test`,
          displayName: "User B",
        },
      }),
    ]);
    const contextB = {
      ...context,
      actorId: userBId,
      organizationId: orgBId,
      membershipId: randomUUID(),
    } as import("@/modules/tenancy/policy").TenantContext;

    // Cross-org customer lookup returns null.
    const crossOrgCustomer = await new CustomerRepository({
      db: dbModule.db,
      context: contextB,
    }).findById(customer.id);
    expect(crossOrgCustomer).toBeNull();

    // Cross-org work order lookup returns null.
    const crossOrgWO = await new WorkOrderRepository({
      db: dbModule.db,
      context: contextB,
    }).findById(workOrder.id);
    expect(crossOrgWO).toBeNull();

    // Cross-org invoice creation fails.
    await expect(
      createInvoiceFromWorkOrder({ db: dbModule.db, context: contextB, workOrderId: workOrder.id }),
    ).rejects.toMatchObject({ reason: "work_order_not_found" });
  });

  it("enforces the immutability of presented estimates", async () => {
    const { createDraftRevision, addLine, presentRevision, EstimateFailed } =
      await import("@/modules/estimates/estimate-service");

    const orgId = randomUUID();
    const locationId = randomUUID();
    const userId = randomUUID();
    await dbModule.db.$transaction([
      dbModule.db.organization.create({
        data: { id: orgId, slug: `im-${orgId.slice(0, 8)}`, name: "Immutability Org" },
      }),
      dbModule.db.location.create({
        data: { id: locationId, organizationId: orgId, code: "M", name: "Main", timeZone: "UTC" },
      }),
      dbModule.db.user.create({
        data: { id: userId, email: `im-${userId.slice(0, 8)}@e.test`, displayName: "IM User" },
      }),
      dbModule.db.organizationMembership.create({
        data: { id: randomUUID(), organizationId: orgId, userId },
      }),
    ]);
    const customer = await dbModule.db.customer.create({
      data: {
        id: randomUUID(),
        organizationId: orgId,
        kind: "INDIVIDUAL",
        displayName: "IM Customer",
      },
    });
    const wo = await dbModule.db.workOrder.create({
      data: {
        id: randomUUID(),
        organizationId: orgId,
        locationId,
        customerId: customer.id,
        number: "RO-9001",
        customerConcern: "IM",
        status: "ESTIMATING",
      },
    });

    const context = {
      actorId: userId,
      organizationId: orgId,
      membershipId: randomUUID(),
      requestId: randomUUID(),
      organizationWideLocationAccess: true,
      allowedLocationIds: new Set<string>(),
      permissions: new Set(["work_orders.write"] as const),
    } as import("@/modules/tenancy/policy").TenantContext;

    const rev = await createDraftRevision({
      db: dbModule.db,
      context,
      workOrderId: wo.id,
      currency: "USD",
    });
    await addLine({
      db: dbModule.db,
      context,
      revisionId: rev.revisionId,
      kind: "FEE",
      serviceGroupKey: "t",
      description: "Test",
      quantityMilli: 1000,
      unitPriceMinor: 100,
      discountMinor: 0,
      taxable: false,
      taxRateBasisPoints: 0,
      position: 1,
    });
    await presentRevision({ db: dbModule.db, context, revisionId: rev.revisionId });

    // Cannot add a line to a presented revision.
    await expect(
      addLine({
        db: dbModule.db,
        context,
        revisionId: rev.revisionId,
        kind: "LABOR",
        serviceGroupKey: "x",
        description: "Should fail",
        quantityMilli: 1000,
        unitPriceMinor: 100,
        discountMinor: 0,
        taxable: false,
        taxRateBasisPoints: 0,
        position: 2,
      }),
    ).rejects.toMatchObject({ reason: "revision_not_draft" });
    expect(new EstimateFailed("revision_not_draft")).toBeInstanceOf(EstimateFailed);
  });
});
