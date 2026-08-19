import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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
  vi.unstubAllGlobals();
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
  const membershipId = randomUUID();
  const roleId = randomUUID();
  const customerId = randomUUID();
  const workOrderId = randomUUID();
  const invoiceId = randomUUID();
  const paymentId = randomUUID();

  await dbModule.db.$transaction([
    dbModule.db.organization.create({
      data: { id: orgId, slug: `org-${orgId.slice(0, 8)}`, name: "Refund Org" },
    }),
    dbModule.db.location.create({
      data: { id: locationId, organizationId: orgId, code: "MAIN", name: "Main", timeZone: "UTC" },
    }),
    dbModule.db.user.create({
      data: {
        id: userId,
        email: `rf-${userId.slice(0, 8)}@example.test`,
        displayName: "Refund Clerk",
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
        permissions: ["work_orders.read", "work_orders.write", "payments.record", "customers.read"],
      },
    }),
    dbModule.db.membershipRole.create({ data: { organizationId: orgId, membershipId, roleId } }),
    dbModule.db.customer.create({
      data: {
        id: customerId,
        organizationId: orgId,
        kind: "INDIVIDUAL",
        displayName: "Refund Customer",
      },
    }),
    dbModule.db.workOrder.create({
      data: {
        id: workOrderId,
        organizationId: orgId,
        locationId,
        customerId,
        number: "RO-1201",
        customerConcern: "Refund test",
        status: "INVOICED",
      },
    }),
    dbModule.db.invoice.create({
      data: {
        id: invoiceId,
        organizationId: orgId,
        locationId,
        workOrderId,
        number: "INV-1201",
        status: "PARTIALLY_PAID",
        currency: "USD",
        subtotalMinor: 200_00n,
        discountMinor: 0n,
        taxMinor: 0n,
        totalMinor: 200_00n,
        paidMinor: 150_00n,
        issuedAt: new Date(),
      },
    }),
    dbModule.db.payment.create({
      data: {
        id: paymentId,
        organizationId: orgId,
        locationId,
        invoiceId,
        amountMinor: 150_00n,
        currency: "USD",
        method: "CASH",
        receivedAt: new Date(Date.now() - 60 * 60 * 1000),
        recordedByUserId: userId,
      },
    }),
  ]);

  const context = (permissions?: readonly string[]) =>
    ({
      actorId: userId,
      organizationId: orgId,
      membershipId,
      requestId: randomUUID(),
      organizationWideLocationAccess: true,
      allowedLocationIds: new Set<string>(),
      permissions: new Set<string>(permissions ?? ["payments.record", "work_orders.read"]),
    }) as import("@/modules/tenancy/policy").TenantContext;

  return { orgId, invoiceId, paymentId, customerId, context };
}

describe("refunds (#187)", { skip: shouldSkip }, () => {
  it("refunds a manual payment, tracking paid net of refunds", async () => {
    const refunds = await import("@/modules/billing/refund-service");
    const ar = await import("@/modules/billing/ar-service");
    const seed = await seedShop();
    const context = seed.context();

    const result = await refunds.refundPayment({
      db: dbModule.db,
      context,
      paymentId: seed.paymentId,
      amountMinor: 50_00,
      reason: "overcharge on diag",
    });
    expect(result.processorRefunded).toBe(false);

    let invoice = await dbModule.db.invoice.findUnique({
      where: { id: seed.invoiceId },
      select: { paidMinor: true, status: true },
    });
    expect(invoice?.paidMinor).toBe(100_00n); // 150 − 50 refund
    expect(invoice?.status).toBe("PARTIALLY_PAID");

    // Payment row immutable; refund is its own record with provenance.
    const payment = await dbModule.db.payment.findUnique({
      where: { id: seed.paymentId },
      select: { amountMinor: true, refunds: { select: { amountMinor: true, reason: true } } },
    });
    expect(payment?.amountMinor).toBe(150_00n);
    expect(payment?.refunds[0]?.reason).toBe("overcharge on diag");

    // Listing shows the refundable remainder.
    const refundable = await refunds.listRefundablePayments({
      db: dbModule.db,
      context,
      invoiceId: seed.invoiceId,
    });
    expect(refundable[0]?.refundableMinor).toBe(100_00n);

    // Refunding the rest drops paid to zero and returns the invoice to ISSUED.
    await refunds.refundPayment({ db: dbModule.db, context, paymentId: seed.paymentId });
    invoice = await dbModule.db.invoice.findUnique({
      where: { id: seed.invoiceId },
      select: { paidMinor: true, status: true },
    });
    expect(invoice?.paidMinor).toBe(0n);
    expect(invoice?.status).toBe("ISSUED");

    // Over-refunding is refused; AR balance reflects the refunded amount.
    await expect(
      refunds.refundPayment({
        db: dbModule.db,
        context,
        paymentId: seed.paymentId,
        amountMinor: 1,
      }),
    ).rejects.toMatchObject({ reason: "refund_exceeds_payment" });
    const balances = await ar.listCustomerBalances({ db: dbModule.db, context });
    expect(balances[0]?.balanceMinor).toBe(200_00n);

    // Statement shows the refund as a balance-increasing line.
    const statement = await ar.getCustomerStatement({
      db: dbModule.db,
      context,
      customerId: seed.customerId,
    });
    const refundLines = statement?.lines.filter((line) => line.kind === "refund") ?? [];
    expect(refundLines.reduce((sum, line) => sum + line.amountMinor, 0n)).toBe(150_00n);
  });

  it("refunds processor payments through the processor first, recording only on success", async () => {
    const refunds = await import("@/modules/billing/refund-service");
    const { generateMasterKey } = await import("@/modules/integrations/crypto/secret-cipher");
    const service = await import("@/modules/integrations/payments/payments-connector-service");
    const seed = await seedShop();
    const context = seed.context();

    env.CONNECTOR_ENCRYPTION_KEY = generateMasterKey();
    await service.upsertOrgPaymentsConnector({
      db: dbModule.db,
      context: {
        ...context,
        permissions: new Set(["organizations.manage"]),
      } as import("@/modules/tenancy/policy").TenantContext,
      adapterKey: "stripe",
      displayName: "Shop Stripe",
      secret: { secretKey: "sk_live_x", webhookSigningSecret: "whsec_x" },
    });

    // A webhook-recorded payment carries its PaymentIntent.
    await dbModule.db.payment.update({
      where: { id: seed.paymentId },
      data: { processorChargeId: "pi_test_123", method: "CARD_EXTERNAL" },
    });

    const refundCalls: string[] = [];
    vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
      refundCalls.push(String(url), String(init?.body));
      return { ok: true, json: () => Promise.resolve({ id: "re_test_1" }) } as unknown as Response;
    });

    const result = await refunds.refundPayment({
      db: dbModule.db,
      context,
      paymentId: seed.paymentId,
      amountMinor: 75_00,
    });
    expect(result.processorRefunded).toBe(true);

    expect(refundCalls[0]).toBe("https://api.stripe.com/v1/refunds");
    const body = new URLSearchParams(refundCalls[1]!);
    expect(body.get("payment_intent")).toBe("pi_test_123");
    expect(body.get("amount")).toBe("7500");

    const refundRow = await dbModule.db.refund.findFirst({
      where: { paymentId: seed.paymentId },
      select: { providerRef: true },
    });
    expect(refundRow?.providerRef).toBe("re_test_1");

    // Processor failure records nothing.
    vi.unstubAllGlobals();
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 402 }) as unknown as Response);
    const paidBefore = await dbModule.db.invoice.findUnique({
      where: { id: seed.invoiceId },
      select: { paidMinor: true },
    });
    await expect(
      refunds.refundPayment({
        db: dbModule.db,
        context,
        paymentId: seed.paymentId,
        amountMinor: 10,
      }),
    ).rejects.toMatchObject({ reason: "processor_refund_failed" });
    const paidAfter = await dbModule.db.invoice.findUnique({
      where: { id: seed.invoiceId },
      select: { paidMinor: true },
    });
    expect(paidAfter?.paidMinor).toBe(paidBefore?.paidMinor);
    expect(await dbModule.db.refund.count({ where: { paymentId: seed.paymentId } })).toBe(1);
    vi.unstubAllGlobals();
  });

  it("requires payment-record access and never touches another organization's payments", async () => {
    const refunds = await import("@/modules/billing/refund-service");
    const { TenantAccessDenied } = await import("@/modules/tenancy/policy");
    const otherOrgId = randomUUID();
    const seed = await seedShop();
    await dbModule.db.organization.create({
      data: { id: otherOrgId, slug: `o-${otherOrgId.slice(0, 8)}`, name: "Other Org" },
    });

    await expect(
      refunds.refundPayment({
        db: dbModule.db,
        context: seed.context(["work_orders.read"]),
        paymentId: seed.paymentId,
      }),
    ).rejects.toThrowError(TenantAccessDenied);

    await expect(
      refunds.refundPayment({
        db: dbModule.db,
        context: {
          ...seed.context(),
          organizationId: otherOrgId,
        } as import("@/modules/tenancy/policy").TenantContext,
        paymentId: seed.paymentId,
      }),
    ).rejects.toMatchObject({ reason: "payment_not_found" });

    const payment = await dbModule.db.payment.findUnique({
      where: { id: seed.paymentId },
      select: { refunds: { select: { id: true } } },
    });
    expect(payment?.refunds).toHaveLength(0);
  });
});
