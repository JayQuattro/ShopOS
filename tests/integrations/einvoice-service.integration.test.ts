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

async function seedShop(orgInput?: { einvoiceFormat?: string; taxId?: string }) {
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
      data: {
        id: orgId,
        slug: `org-${orgId.slice(0, 8)}`,
        name: "DE GmbH",
        taxId: orgInput?.taxId ?? "DE123456789",
        ...(orgInput?.einvoiceFormat ? { einvoiceFormat: orgInput.einvoiceFormat } : {}),
      },
    }),
    dbModule.db.organization.create({
      data: {
        id: otherOrgId,
        slug: `o-${otherOrgId.slice(0, 8)}`,
        name: "Other Org",
        einvoiceFormat: "factur-x",
      },
    }),
    dbModule.db.location.create({
      data: { id: locationId, organizationId: orgId, code: "MAIN", name: "Main", timeZone: "UTC" },
    }),
    dbModule.db.user.create({
      data: {
        id: userId,
        email: `ei-${userId.slice(0, 8)}@example.test`,
        displayName: "Invoice Clerk",
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
        permissions: ["work_orders.write", "work_orders.read", "invoices.issue"],
      },
    }),
    dbModule.db.membershipRole.create({ data: { organizationId: orgId, membershipId, roleId } }),
    dbModule.db.customer.create({
      data: {
        id: customerId,
        organizationId: orgId,
        kind: "BUSINESS",
        displayName: "Müller GmbH",
        taxId: "DE987654321",
        addresses: {
          create: {
            id: randomUUID(),
            label: "main",
            line1: "Straße 1",
            city: "Hamburg",
            postalCode: "20095",
            country: "DE",
            isPrimary: true,
          },
        },
      },
    }),
    dbModule.db.workOrder.create({
      data: {
        id: workOrderId,
        organizationId: orgId,
        locationId,
        customerId,
        number: "RO-EI1",
        customerConcern: "einvoice test",
        status: "INVOICED",
      },
    }),
    dbModule.db.invoice.create({
      data: {
        id: invoiceId,
        organizationId: orgId,
        locationId,
        workOrderId,
        number: "2026-B-1001",
        status: "ISSUED",
        currency: "EUR",
        subtotalMinor: 100_00n,
        discountMinor: 0n,
        taxMinor: 16_67n,
        taxInclusive: true,
        totalMinor: 100_00n,
        paidMinor: 0n,
        issuedAt: new Date("2026-08-25T10:00:00Z"),
        lines: {
          create: [
            {
              id: randomUUID(),
              kind: "LABOR",
              description: "Brake service",
              quantityMilli: 1000,
              unitPriceMinor: 100_00n,
              grossMinor: 100_00n,
              discountMinor: 0n,
              taxable: true,
              taxRateBasisPoints: 2000,
              taxMinor: 16_67n,
              taxInclusive: true,
              totalMinor: 100_00n,
              position: 1,
            },
          ],
        },
      },
    }),
  ]);

  const context = (organizationIdOverride?: string) =>
    ({
      actorId: userId,
      organizationId: organizationIdOverride ?? orgId,
      membershipId,
      requestId: randomUUID(),
      organizationWideLocationAccess: true,
      allowedLocationIds: new Set<string>(),
      permissions: new Set(["invoices.issue", "work_orders.read"]),
    }) as import("@/modules/tenancy/policy").TenantContext;

  return { orgId, otherOrgId, invoiceId, context };
}

describe("e-invoice generation (#197)", { skip: shouldSkip }, () => {
  it("generates and stores Factur-X XML for an issued invoice, deterministically", async () => {
    const service = await import("@/modules/integrations/einvoicing/einvoice-service");
    const seed = await seedShop({ einvoiceFormat: "factur-x" });

    const first = await service.generateEInvoice({
      db: dbModule.db,
      context: seed.context(),
      invoiceId: seed.invoiceId,
    });
    expect(first.format).toBe("factur-x");
    expect(first.invoiceNumber).toBe("2026-B-1001");
    expect(first.contentHash).toMatch(/^[a-f0-9]{64}$/);

    const stored = await service.getEInvoiceDocument({
      db: dbModule.db,
      context: seed.context(),
      invoiceId: seed.invoiceId,
    });
    expect(stored.xml).toContain("2026-B-1001");
    expect(stored.xml).toContain('<ram:ID schemeID="VA">123456789</ram:ID>');
    expect(stored.xml).toContain("Müller GmbH");
    expect(stored.filename).toContain("2026-B-1001");

    // Same input → same hash; regeneration replaces in place with audit.
    const second = await service.generateEInvoice({
      db: dbModule.db,
      context: seed.context(),
      invoiceId: seed.invoiceId,
    });
    expect(second.contentHash).toBe(first.contentHash);
    expect(await dbModule.db.eInvoiceDocument.count({ where: { invoiceId: seed.invoiceId } })).toBe(
      1,
    );
    const audits = await dbModule.db.auditEvent.findMany({
      where: {
        entityType: "invoice",
        entityId: seed.invoiceId,
        action: { startsWith: "einvoice." },
      },
      orderBy: { occurredAt: "asc" },
    });
    expect(audits.map((a) => a.action)).toEqual(["einvoice.generated", "einvoice.regenerated"]);
  });

  it("generates XRechnung when that is the configured format", async () => {
    const service = await import("@/modules/integrations/einvoicing/einvoice-service");
    const seed = await seedShop({ einvoiceFormat: "xrechnung" });

    const document = await service.generateEInvoice({
      db: dbModule.db,
      context: seed.context(),
      invoiceId: seed.invoiceId,
    });
    expect(document.format).toBe("xrechnung");

    const stored = await service.getEInvoiceDocument({
      db: dbModule.db,
      context: seed.context(),
      invoiceId: seed.invoiceId,
    });
    expect(stored.xml).toContain("urn:xoev-de:kosit:standard:xrechnung_3.0");
    expect(stored.xml).toContain("<cbc:CompanyID>987654321</cbc:CompanyID>");
  });

  it("rejects unconfigured orgs, unissued invoices, and foreign tenants", async () => {
    const service = await import("@/modules/integrations/einvoicing/einvoice-service");
    const { TenantAccessDenied } = await import("@/modules/tenancy/policy");
    const seed = await seedShop(); // no format configured

    await expect(
      service.generateEInvoice({
        db: dbModule.db,
        context: seed.context(),
        invoiceId: seed.invoiceId,
      }),
    ).rejects.toMatchObject({ reason: "no_format_configured" });

    await dbModule.db.organization.update({
      where: { id: seed.orgId },
      data: { einvoiceFormat: "factur-x" },
    });
    await dbModule.db.invoice.update({
      where: { id: seed.invoiceId },
      data: { status: "DRAFT", issuedAt: null },
    });
    await expect(
      service.generateEInvoice({
        db: dbModule.db,
        context: seed.context(),
        invoiceId: seed.invoiceId,
      }),
    ).rejects.toMatchObject({ reason: "invoice_not_issued" });

    // Another organization's context never sees the invoice.
    await dbModule.db.invoice.update({
      where: { id: seed.invoiceId },
      data: { status: "ISSUED", issuedAt: new Date() },
    });
    await expect(
      service.generateEInvoice({
        db: dbModule.db,
        context: seed.context(seed.otherOrgId),
        invoiceId: seed.invoiceId,
      }),
    ).rejects.toMatchObject({ reason: "invoice_not_found" });
    await expect(
      service.getEInvoiceDocument({
        db: dbModule.db,
        context: {
          ...seed.context(),
          permissions: new Set(["work_orders.read"]),
        } as import("@/modules/tenancy/policy").TenantContext,
        invoiceId: seed.invoiceId,
      }),
    ).rejects.toThrowError(TenantAccessDenied);
    expect(await dbModule.db.eInvoiceDocument.count()).toBe(0);
  });
});
