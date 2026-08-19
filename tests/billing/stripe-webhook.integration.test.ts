import { execFileSync } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { verifyStripeWebhook } from "@/modules/integrations/payments/payments-adapters";
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

const savedKey = env.CONNECTOR_ENCRYPTION_KEY;

beforeAll(async () => {
  if (!RUN) return;
  dbModule = await import("@/db/client");
  await resetTestDatabase(dbModule.db);
}, 30_000);

afterAll(async () => {
  if (!RUN) return;
  env.CONNECTOR_ENCRYPTION_KEY = savedKey;
  await resetTestDatabase(dbModule.db);
  await dbModule.db.$disconnect();
});

beforeEach(async () => {
  if (!RUN) return;
  await resetTestDatabase(dbModule.db);
});

// ─── Signature verification (pure) ──────────────────────────────────────────

const SIGNING_SECRET = "whsec_test_signing";

function signedEvent(
  payload: unknown,
  secret = SIGNING_SECRET,
  ageSeconds = 10,
): {
  rawBody: string;
  header: string;
} {
  const rawBody = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000) - ageSeconds;
  const signature = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return { rawBody, header: `t=${timestamp},v1=${signature}` };
}

const sessionPayload = {
  id: "cs_test_session",
  client_reference_id: "irrelevant-here",
  payment_status: "paid",
  amount_total: 200_00,
  currency: "usd",
};

describe("stripe webhook verification", () => {
  it("accepts a correctly signed, fresh event", () => {
    const { rawBody, header } = signedEvent(sessionPayload);
    const event = verifyStripeWebhook({
      signingSecret: SIGNING_SECRET,
      signatureHeader: header,
      rawBody,
    });
    expect(event).toMatchObject({ id: "cs_test_session", payment_status: "paid" });
  });

  it("rejects tampered bodies, wrong secrets, stale timestamps, and missing pieces", () => {
    const { rawBody, header } = signedEvent(sessionPayload);

    // Tampered payload (signature covers different bytes).
    expect(
      verifyStripeWebhook({
        signingSecret: SIGNING_SECRET,
        signatureHeader: header,
        rawBody: rawBody.replace("20000", "99999"),
      }),
    ).toBeNull();

    // Wrong secret.
    const wrongSecret = signedEvent(sessionPayload, "whsec_other");
    expect(
      verifyStripeWebhook({
        signingSecret: SIGNING_SECRET,
        signatureHeader: wrongSecret.header,
        rawBody: wrongSecret.rawBody,
      }),
    ).toBeNull();

    // Stale beyond tolerance.
    const stale = signedEvent(sessionPayload, SIGNING_SECRET, 60 * 60);
    expect(
      verifyStripeWebhook({
        signingSecret: SIGNING_SECRET,
        signatureHeader: stale.header,
        rawBody: stale.rawBody,
      }),
    ).toBeNull();

    // Missing secret / header / timestamp.
    expect(
      verifyStripeWebhook({ signingSecret: undefined, signatureHeader: header, rawBody }),
    ).toBeNull();
    expect(
      verifyStripeWebhook({ signingSecret: SIGNING_SECRET, signatureHeader: null, rawBody }),
    ).toBeNull();
    expect(
      verifyStripeWebhook({
        signingSecret: SIGNING_SECRET,
        signatureHeader: "v1=deadbeef",
        rawBody,
      }),
    ).toBeNull();
  });
});

// ─── Recording from verified events (integration) ──────────────────────────

async function seedShop() {
  const orgId = randomUUID();
  const locationId = randomUUID();
  const userId = randomUUID();
  const customerId = randomUUID();
  const workOrderId = randomUUID();
  const invoiceId = randomUUID();

  await dbModule.db.$transaction([
    dbModule.db.organization.create({
      data: { id: orgId, slug: `org-${orgId.slice(0, 8)}`, name: "Webhook Org" },
    }),
    dbModule.db.location.create({
      data: { id: locationId, organizationId: orgId, code: "MAIN", name: "Main", timeZone: "UTC" },
    }),
    dbModule.db.user.create({
      data: {
        id: userId,
        email: `w-${userId.slice(0, 8)}@example.test`,
        displayName: "Webhook User",
      },
    }),
    dbModule.db.customer.create({
      data: {
        id: customerId,
        organizationId: orgId,
        kind: "INDIVIDUAL",
        displayName: "Webhook Customer",
      },
    }),
    dbModule.db.workOrder.create({
      data: {
        id: workOrderId,
        organizationId: orgId,
        locationId,
        customerId,
        number: "RO-9901",
        customerConcern: "Webhook test",
      },
    }),
    dbModule.db.invoice.create({
      data: {
        id: invoiceId,
        organizationId: orgId,
        locationId,
        workOrderId,
        number: "INV-9901",
        status: "ISSUED",
        currency: "USD",
        subtotalMinor: 300_00n,
        discountMinor: 0n,
        taxMinor: 0n,
        totalMinor: 300_00n,
        paidMinor: 0n,
        issuedAt: new Date(),
        paymentUrl: "https://checkout.stripe.com/c/pay/cs_test_session",
        paymentLinkRef: "cs_test_session",
      },
    }),
  ]);

  return { orgId, invoiceId };
}

describe("recording stripe checkout completion (#185)", { skip: shouldSkip }, () => {
  it("records the payment exactly once with full provenance", async () => {
    const service = await import("@/modules/billing/processor-payment-service");
    const seed = await seedShop();

    const first = await service.recordStripeCheckoutCompleted(dbModule.db, seed.orgId, {
      id: "evt_1",
      data: {
        object: {
          id: "cs_test_session",
          client_reference_id: seed.invoiceId,
          payment_status: "paid",
          amount_total: 200_00,
          currency: "usd",
          payment_intent: "pi_first",
        },
      },
    });
    expect(first).toMatchObject({
      kind: "recorded",
      invoiceId: seed.invoiceId,
      amountMinor: 200_00,
    });

    const invoice = await dbModule.db.invoice.findUnique({
      where: { id: seed.invoiceId },
      select: { paidMinor: true, status: true },
    });
    expect(invoice?.paidMinor).toBe(200_00n);
    expect(invoice?.status).toBe("PARTIALLY_PAID");

    // Provenance: payment reference, activity, audit.
    const payment = await dbModule.db.payment.findFirst({
      where: { invoiceId: seed.invoiceId },
      select: { reference: true, method: true, recordedBy: { select: { email: true } } },
    });
    expect(payment?.reference).toBe("stripe:cs_test_session");
    expect(payment?.method).toBe("CARD_EXTERNAL");
    expect(payment?.recordedBy.email).toBe("system@shopos.internal");
    const audit = await dbModule.db.auditEvent.findFirst({
      where: { action: "payment.processor_recorded", entityId: seed.invoiceId },
    });
    expect(audit?.requestId).toBe("stripe:cs_test_session");

    // Replay is a no-op.
    const replay = await service.recordStripeCheckoutCompleted(dbModule.db, seed.orgId, {
      id: "evt_1",
      data: {
        object: {
          id: "cs_test_session",
          client_reference_id: seed.invoiceId,
          payment_status: "paid",
          amount_total: 200_00,
          currency: "usd",
          payment_intent: "pi_first",
        },
      },
    });
    expect(replay).toMatchObject({ kind: "duplicate" });
    expect(await dbModule.db.payment.count({ where: { invoiceId: seed.invoiceId } })).toBe(1);
    expect(
      (
        await dbModule.db.invoice.findUnique({
          where: { id: seed.invoiceId },
          select: { paidMinor: true },
        })
      )?.paidMinor,
    ).toBe(200_00n);

    // A second session for the same invoice (stale-link case) records the
    // remaining balance and settles the invoice — clamped, idempotent per
    // session id.
    const second = await service.recordStripeCheckoutCompleted(dbModule.db, seed.orgId, {
      id: "evt_2",
      data: {
        object: {
          id: "cs_test_session_2",
          client_reference_id: seed.invoiceId,
          payment_status: "paid",
          amount_total: 250_00,
          currency: "usd",
          payment_intent: "pi_second",
        },
      },
    });
    expect(second).toMatchObject({ kind: "recorded", amountMinor: 100_00 });
    const settled = await dbModule.db.invoice.findUnique({
      where: { id: seed.invoiceId },
      select: { status: true, paidMinor: true },
    });
    expect(settled?.status).toBe("PAID");
    expect(settled?.paidMinor).toBe(300_00n);

    // Once settled, further events for the same invoice are a no-op.
    const third = await service.recordStripeCheckoutCompleted(dbModule.db, seed.orgId, {
      id: "evt_3",
      data: {
        object: {
          id: "cs_test_session_3",
          client_reference_id: seed.invoiceId,
          payment_status: "paid",
          amount_total: 50_00,
          currency: "usd",
          payment_intent: "pi_third",
        },
      },
    });
    expect(third).toMatchObject({ kind: "ignored", reason: "already_settled" });
    expect(await dbModule.db.payment.count({ where: { invoiceId: seed.invoiceId } })).toBe(2);
  });

  it("ignores unpaid sessions, wrong-org invoices, and unpayable invoices", async () => {
    const service = await import("@/modules/billing/processor-payment-service");
    const seed = await seedShop();

    // Not yet paid.
    expect(
      await service.recordStripeCheckoutCompleted(dbModule.db, seed.orgId, {
        id: "evt_u",
        data: {
          object: {
            id: "cs_test_session",
            client_reference_id: seed.invoiceId,
            payment_status: "unpaid",
            amount_total: 100,
            currency: "usd",
          },
        },
      }),
    ).toMatchObject({ kind: "ignored", reason: "payment_status_not_paid" });

    // Invoice id from another organization — scoped query finds nothing.
    expect(
      await service.recordStripeCheckoutCompleted(dbModule.db, randomUUID(), {
        id: "evt_x",
        data: {
          object: {
            id: "cs_test_session",
            client_reference_id: seed.invoiceId,
            payment_status: "paid",
            amount_total: 100,
            currency: "usd",
          },
        },
      }),
    ).toMatchObject({ kind: "ignored", reason: "invoice_not_found" });

    // Draft invoice.
    await dbModule.db.invoice.update({
      where: { id: seed.invoiceId },
      data: { status: "DRAFT", issuedAt: null },
    });
    expect(
      await service.recordStripeCheckoutCompleted(dbModule.db, seed.orgId, {
        id: "evt_d",
        data: {
          object: {
            id: "cs_test_session",
            client_reference_id: seed.invoiceId,
            payment_status: "paid",
            amount_total: 100,
            currency: "usd",
          },
        },
      }),
    ).toMatchObject({ kind: "ignored", reason: "invoice_not_payable" });

    expect(await dbModule.db.payment.count({ where: { invoiceId: seed.invoiceId } })).toBe(0);
  });
});
