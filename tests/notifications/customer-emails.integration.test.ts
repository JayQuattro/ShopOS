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

async function seedInvoiceReadyWorkOrder() {
  const orgId = randomUUID();
  const locationId = randomUUID();
  const userId = randomUUID();
  const membershipId = randomUUID();
  const roleId = randomUUID();
  const customerId = randomUUID();
  const lineId = randomUUID();

  await dbModule.db.$transaction([
    dbModule.db.organization.create({
      data: { id: orgId, slug: `org-${orgId.slice(0, 8)}`, name: "Notify Org" },
    }),
    dbModule.db.location.create({
      data: { id: locationId, organizationId: orgId, code: "MAIN", name: "Main", timeZone: "UTC" },
    }),
    dbModule.db.user.create({
      data: {
        id: userId,
        email: `u-${userId.slice(0, 8)}@example.test`,
        displayName: "Notify User",
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
        displayName: "Notify Customer",
        primaryEmail: "notify-customer@example.test",
      },
    }),
    dbModule.db.workOrder.create({
      data: {
        organizationId: orgId,
        locationId,
        customerId,
        number: "RO-6001",
        customerConcern: "Full loop",
        status: "IN_PROGRESS",
      },
    }),
  ]);

  const wo = await dbModule.db.workOrder.findFirst({ where: { organizationId: orgId } });
  const revision = await dbModule.db.estimateRevision.create({
    data: {
      organizationId: orgId,
      locationId,
      workOrderId: wo!.id,
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
      estimateRevisionId: revision.id,
      serviceGroupKey: "brakes",
      kind: "LABOR",
      description: "Brake service",
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

  return {
    orgId,
    locationId,
    workOrderId: wo!.id,
    revisionId: revision.id,
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
          "authorizations.record",
          "invoices.issue",
          "payments.record",
        ] as const),
      }) as import("@/modules/tenancy/policy").TenantContext,
  };
}

async function drainOnce() {
  const { OutboxDispatcher } = await import("@/modules/outbox/outbox-dispatcher");
  const { EventHandlerRegistry } = await import("@/modules/outbox/event-handler");
  const { EstimatePresentedEmailHandler } =
    await import("@/modules/estimates/estimate-email-handler");
  const { AuthorizationRecordedEmailHandler } =
    await import("@/modules/estimates/authorization-receipt-handler");
  const { InvoiceIssuedEmailHandler, PaymentRecordedEmailHandler } =
    await import("@/modules/invoices/invoice-email-handlers");
  const handlers = new EventHandlerRegistry();
  handlers.register(new EstimatePresentedEmailHandler(dbModule.db));
  handlers.register(new AuthorizationRecordedEmailHandler(dbModule.db));
  handlers.register(new InvoiceIssuedEmailHandler(dbModule.db));
  handlers.register(new PaymentRecordedEmailHandler(dbModule.db));
  const dispatcher = new OutboxDispatcher({ db: dbModule.db, handlers });
  return dispatcher.drainOnce();
}

describe("customer notification loop (#131)", { skip: shouldSkip }, () => {
  it("emails a receipt when staff record a verbal authorization", async () => {
    const { getConsoleEmailSender } =
      await import("@/modules/integrations/email/transactional-email");
    getConsoleEmailSender().reset();
    const seed = await seedInvoiceReadyWorkOrder();

    const { recordAuthorization } = await import("@/modules/estimates/authorization-service");
    await recordAuthorization({
      db: dbModule.db,
      context: seed.context(),
      revisionId: seed.revisionId,
      method: "PHONE",
      providedByName: "Notify Customer",
      decisions: [{ estimateLineId: seed.lineId, decision: "APPROVED" as const }],
    });

    const summary = await drainOnce();
    expect(summary.failed).toBe(0);

    const sent = getConsoleEmailSender().sentEmails();
    const receipt = sent.find((email) => email.subject.includes("decision recorded"));
    expect(receipt?.to).toBe("notify-customer@example.test");
    expect(receipt?.subject).toContain("RO-6001");
    expect(receipt?.subject).not.toMatch(/authorize\//);

    const activity = await dbModule.db.activityEvent.findFirst({
      where: { organizationId: seed.orgId, eventType: "authorization.email_sent" },
    });
    expect(activity).not.toBeNull();
  });

  it("emails when an invoice is issued and when payment is recorded", async () => {
    const { getConsoleEmailSender } =
      await import("@/modules/integrations/email/transactional-email");
    getConsoleEmailSender().reset();
    const seed = await seedInvoiceReadyWorkOrder();
    const context = seed.context();

    // Approve the baseline so invoicing is possible.
    const { recordAuthorization } = await import("@/modules/estimates/authorization-service");
    await recordAuthorization({
      db: dbModule.db,
      context,
      revisionId: seed.revisionId,
      method: "PHONE",
      providedByName: "Notify Customer",
      decisions: [{ estimateLineId: seed.lineId, decision: "APPROVED" as const }],
    });
    await drainOnce(); // receipt email
    getConsoleEmailSender().reset();

    const { createInvoiceFromWorkOrder, issueInvoice, recordPayment } =
      await import("@/modules/invoices/invoice-service");
    const { invoiceId } = await createInvoiceFromWorkOrder({
      db: dbModule.db,
      context,
      workOrderId: seed.workOrderId,
    });
    await issueInvoice({ db: dbModule.db, context, invoiceId });
    await drainOnce();

    let sent = getConsoleEmailSender().sentEmails();
    const invoiceEmail = sent.find((email) => email.subject.includes("Invoice INV-"));
    expect(invoiceEmail?.to).toBe("notify-customer@example.test");
    getConsoleEmailSender().reset();

    await recordPayment({
      db: dbModule.db,
      context,
      invoiceId,
      amountMinor: 10600,
      method: "CASH",
    });
    await drainOnce();

    sent = getConsoleEmailSender().sentEmails();
    const receipt = sent.find((email) => email.subject.includes("Payment received"));
    expect(receipt?.to).toBe("notify-customer@example.test");

    const activity = await dbModule.db.activityEvent.findFirst({
      where: { organizationId: seed.orgId, eventType: "payment.email_sent" },
    });
    expect(activity).not.toBeNull();
  });

  it("completes without retry churn when the customer has no email", async () => {
    const { getConsoleEmailSender } =
      await import("@/modules/integrations/email/transactional-email");
    getConsoleEmailSender().reset();
    const seed = await seedInvoiceReadyWorkOrder();
    await dbModule.db.customer.updateMany({
      where: { organizationId: seed.orgId },
      data: { primaryEmail: null },
    });

    const { recordAuthorization } = await import("@/modules/estimates/authorization-service");
    await recordAuthorization({
      db: dbModule.db,
      context: seed.context(),
      revisionId: seed.revisionId,
      method: "IN_PERSON",
      providedByName: "Notify Customer",
      decisions: [{ estimateLineId: seed.lineId, decision: "APPROVED" as const }],
    });

    const summary = await drainOnce();
    expect(summary.dispatched).toBe(1);
    expect(summary.failed).toBe(0);
    expect(getConsoleEmailSender().sentEmails()).toHaveLength(0);

    const activity = await dbModule.db.activityEvent.findFirst({
      where: { organizationId: seed.orgId, eventType: "authorization.email_skipped" },
    });
    expect(activity).not.toBeNull();
  });
});
