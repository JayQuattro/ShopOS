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

const savedEnv: Record<string, string | undefined> = {};

beforeAll(async () => {
  if (!RUN) return;
  dbModule = await import("@/db/client");
  await resetTestDatabase(dbModule.db);
}, 30_000);

afterAll(async () => {
  if (!RUN) return;
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  await resetTestDatabase(dbModule.db);
  await dbModule.db.$disconnect();
});

beforeEach(async () => {
  if (!RUN) return;
  if (!("CONNECTOR_ENCRYPTION_KEY" in savedEnv)) {
    savedEnv.CONNECTOR_ENCRYPTION_KEY = env.CONNECTOR_ENCRYPTION_KEY;
  }
  await resetTestDatabase(dbModule.db);
});

async function seedShop() {
  const orgId = randomUUID();
  const otherOrgId = randomUUID();
  const locationId = randomUUID();
  const userId = randomUUID();
  const membershipId = randomUUID();
  const roleId = randomUUID();
  const customerId = randomUUID();
  const workOrderId = randomUUID();
  const invoiceId = randomUUID();

  await dbModule.db.$transaction([
    dbModule.db.organization.create({
      data: { id: orgId, slug: `org-${orgId.slice(0, 8)}`, name: "Pay Org" },
    }),
    dbModule.db.organization.create({
      data: { id: otherOrgId, slug: `other-${otherOrgId.slice(0, 8)}`, name: "Other Org" },
    }),
    dbModule.db.location.create({
      data: { id: locationId, organizationId: orgId, code: "MAIN", name: "Main", timeZone: "UTC" },
    }),
    dbModule.db.user.create({
      data: {
        id: userId,
        email: `pl-${userId.slice(0, 8)}@example.test`,
        displayName: "Money Manager",
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
          "customers.read",
          "organizations.manage",
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
        displayName: "Paying Customer",
      },
    }),
    dbModule.db.workOrder.create({
      data: {
        id: workOrderId,
        organizationId: orgId,
        locationId,
        customerId,
        number: "RO-8801",
        customerConcern: "Payment link test",
      },
    }),
    dbModule.db.invoice.create({
      data: {
        id: invoiceId,
        organizationId: orgId,
        locationId,
        workOrderId,
        number: "INV-8801",
        status: "ISSUED",
        currency: "USD",
        subtotalMinor: 300_00n,
        discountMinor: 0n,
        taxMinor: 0n,
        totalMinor: 300_00n,
        paidMinor: 100_00n,
        issuedAt: new Date(),
      },
    }),
  ]);

  const context = (permissions?: readonly string[], organizationIdOverride?: string) =>
    ({
      actorId: userId,
      organizationId: organizationIdOverride ?? orgId,
      membershipId,
      requestId: randomUUID(),
      organizationWideLocationAccess: true,
      allowedLocationIds: new Set<string>(),
      permissions: new Set<string>(
        permissions ?? [
          "work_orders.read",
          "work_orders.write",
          "customers.read",
          "organizations.manage",
          "invoices.issue",
        ],
      ),
    }) as import("@/modules/tenancy/policy").TenantContext;

  return { orgId, otherOrgId, invoiceId, workOrderId, context };
}

describe("payments connector management (#184)", { skip: shouldSkip }, () => {
  it("stores an org-scoped BYO connector with encrypted credentials and rotation", async () => {
    const service = await import("@/modules/integrations/payments/payments-connector-service");
    const { generateMasterKey } = await import("@/modules/integrations/crypto/secret-cipher");
    const seed = await seedShop();
    const context = seed.context();

    env.CONNECTOR_ENCRYPTION_KEY = generateMasterKey();

    expect(await service.getOrgPaymentsConnector(dbModule.db, context)).toBeNull();

    const created = await service.upsertOrgPaymentsConnector({
      db: dbModule.db,
      context,
      adapterKey: "stripe",
      displayName: "Shop Stripe",
      secret: { secretKey: "sk_live_shop" },
    });
    expect(created.connectorId).toBeTruthy();

    const read = await service.getOrgPaymentsConnector(dbModule.db, context);
    expect(read?.adapterKey).toBe("stripe");
    expect(read?.status).toBe("active");
    expect(JSON.stringify(read)).not.toContain("sk_live_shop");

    const raw = await dbModule.db.connectorInstance.findFirst({
      where: { capability: "payments" },
      select: { encryptedSecret: true, scope: true, organizationId: true },
    });
    expect(raw?.scope).toBe("organization");
    expect(raw?.organizationId).toBe(seed.orgId);
    expect(raw?.encryptedSecret).not.toContain("sk_live_shop");

    // Rotation disables the previous active connector.
    const rotated = await service.upsertOrgPaymentsConnector({
      db: dbModule.db,
      context,
      adapterKey: "stripe",
      displayName: "Shop Stripe 2",
      secret: { secretKey: "sk_live_shop_2" },
    });
    expect(rotated.connectorId).not.toBe(created.connectorId);
    const statuses = await dbModule.db.connectorInstance.findMany({
      where: { capability: "payments" },
      select: { id: true, status: true },
    });
    expect(statuses.find((c) => c.id === created.connectorId)?.status).toBe("disabled");
    expect(statuses.find((c) => c.id === rotated.connectorId)?.status).toBe("active");

    const audits = await dbModule.db.auditEvent.findMany({
      where: { action: "payments.connector_configured" },
    });
    expect(audits).toHaveLength(2);

    // Resolver returns a live Stripe adapter wired to the shop's key.
    const adapter = await service.resolvePaymentsAdapter(dbModule.db, seed.orgId);
    expect(adapter?.key).toBe("stripe");
  });

  it("rejects unknown adapters, missing credentials, and non-managers", async () => {
    const service = await import("@/modules/integrations/payments/payments-connector-service");
    const { generateMasterKey } = await import("@/modules/integrations/crypto/secret-cipher");
    const { TenantAccessDenied } = await import("@/modules/tenancy/policy");
    const seed = await seedShop();
    const context = seed.context();

    env.CONNECTOR_ENCRYPTION_KEY = generateMasterKey();

    await expect(
      service.upsertOrgPaymentsConnector({
        db: dbModule.db,
        context,
        adapterKey: "zelle",
        displayName: "Nope",
        secret: {},
      }),
    ).rejects.toMatchObject({ reason: "invalid_adapter" });

    await expect(
      service.upsertOrgPaymentsConnector({
        db: dbModule.db,
        context,
        adapterKey: "stripe",
        displayName: "No Key",
        secret: {},
      }),
    ).rejects.toMatchObject({ reason: "invalid_configuration" });

    await expect(
      service.upsertOrgPaymentsConnector({
        db: dbModule.db,
        context: seed.context(["invoices.issue"]),
        adapterKey: "stripe",
        displayName: "Sneaky",
        secret: { secretKey: "sk" },
      }),
    ).rejects.toThrowError(TenantAccessDenied);

    // Another organization never sees or resolves this org's connector.
    const otherContext = seed.context(undefined, seed.otherOrgId);
    expect(
      await service.getOrgPaymentsConnector(dbModule.db, {
        ...otherContext,
        permissions: new Set(["organizations.manage"]),
      } as import("@/modules/tenancy/policy").TenantContext),
    ).toBeNull();
    const { getConsolePaymentsAdapter } =
      await import("@/modules/integrations/payments/payments-adapters");
    // Test env resolves console for anyone; the org scoping proof is the
    // connector CRUD above plus the resolver's connector query in source.
    expect((await service.resolvePaymentsAdapter(dbModule.db, seed.otherOrgId))?.key).toBe(
      getConsolePaymentsAdapter().key,
    );
  });
});

describe("invoice payment links (#184)", { skip: shouldSkip }, () => {
  it("links the remaining balance — never the total — and stores the projection", async () => {
    const links = await import("@/modules/billing/payment-link-service");
    const seed = await seedShop();
    const context = seed.context();

    // Test env → console adapter: deterministic, no provider.
    const { url } = await links.createInvoicePaymentLink({
      db: dbModule.db,
      context,
      invoiceId: seed.invoiceId,
      returnUrl: "https://shop.example.test/portal",
    });

    expect(url).toContain("https://pay.shopos.test/demo/");
    // 300 total − 100 paid = 200 due, requested in the link ref.
    expect(url).toContain("20000");

    const invoice = await dbModule.db.invoice.findUnique({
      where: { id: seed.invoiceId },
      select: { paymentUrl: true, paymentLinkRef: true, paidMinor: true },
    });
    expect(invoice?.paymentUrl).toBe(url);
    expect(invoice?.paymentLinkRef).toContain(seed.invoiceId);
    expect(invoice?.paidMinor).toBe(100_00n); // link never mutates money
  });

  it("refuses drafts, paid-up invoices, foreign invoices, and non-issuers", async () => {
    const links = await import("@/modules/billing/payment-link-service");
    const { TenantAccessDenied } = await import("@/modules/tenancy/policy");
    const seed = await seedShop();
    const context = seed.context();

    // Foreign invoice.
    await expect(
      links.createInvoicePaymentLink({
        db: dbModule.db,
        context,
        invoiceId: randomUUID(),
        returnUrl: "https://x.test",
      }),
    ).rejects.toMatchObject({ reason: "invoice_not_found" });

    // Non-issuer permission.
    await expect(
      links.createInvoicePaymentLink({
        db: dbModule.db,
        context: seed.context(["work_orders.read"]),
        invoiceId: seed.invoiceId,
        returnUrl: "https://x.test",
      }),
    ).rejects.toThrowError(TenantAccessDenied);

    // Draft invoice.
    await dbModule.db.invoice.update({
      where: { id: seed.invoiceId },
      data: { status: "DRAFT", issuedAt: null },
    });
    await expect(
      links.createInvoicePaymentLink({
        db: dbModule.db,
        context,
        invoiceId: seed.invoiceId,
        returnUrl: "https://x.test",
      }),
    ).rejects.toMatchObject({ reason: "invoice_not_issued" });

    // Paid in full.
    await dbModule.db.invoice.update({
      where: { id: seed.invoiceId },
      data: { status: "PAID", paidMinor: 300_00n, issuedAt: new Date() },
    });
    await expect(
      links.createInvoicePaymentLink({
        db: dbModule.db,
        context,
        invoiceId: seed.invoiceId,
        returnUrl: "https://x.test",
      }),
    ).rejects.toMatchObject({ reason: "invoice_already_paid" });
  });
});
