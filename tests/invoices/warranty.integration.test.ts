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

async function seedShop(name: string) {
  const orgId = randomUUID();
  const locationId = randomUUID();
  const userId = randomUUID();
  const membershipId = randomUUID();
  const roleId = randomUUID();
  const customerId = randomUUID();
  const assetId = randomUUID();

  await dbModule.db.$transaction([
    dbModule.db.organization.create({
      data: {
        id: orgId,
        slug: `org-${orgId.slice(0, 8)}`,
        name,
        defaultCurrency: "USD",
        defaultWarrantyMonths: 24,
        defaultWarrantyMiles: 24_000,
      },
    }),
    dbModule.db.location.create({
      data: { id: locationId, organizationId: orgId, code: "MAIN", name: "Main", timeZone: "UTC" },
    }),
    dbModule.db.user.create({
      data: {
        id: userId,
        email: `w-${userId.slice(0, 8)}@example.test`,
        displayName: `${name} User`,
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
        displayName: `${name} Customer`,
      },
    }),
    dbModule.db.asset.create({
      data: {
        id: assetId,
        organizationId: orgId,
        customerId,
        displayName: "Civic",
        category: "automotive",
        status: "ACTIVE",
      },
    }),
    dbModule.db.automotiveAssetProfile.create({
      data: { assetId, lastKnownMileage: 68_400 },
    }),
  ]);

  return {
    orgId,
    locationId,
    userId,
    customerId,
    assetId,
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
          "authorizations.record",
          "invoices.issue",
        ] as const),
      }) as import("@/modules/tenancy/policy").TenantContext,
  };
}

/** An issued invoice with warranty terms attached to a work order. */
async function issuedWarrantyInvoice(opts: {
  orgId: string;
  locationId: string;
  customerId: string;
  assetId: string;
  number: string;
  issuedAt: Date;
  warrantyMonths: number | null;
  warrantyMiles: number | null;
}) {
  const wo = await dbModule.db.workOrder.create({
    data: {
      organizationId: opts.orgId,
      locationId: opts.locationId,
      customerId: opts.customerId,
      assetId: opts.assetId,
      number: opts.number,
      customerConcern: "warranty coverage test",
      status: "CLOSED",
    },
  });
  return dbModule.db.invoice.create({
    data: {
      organizationId: opts.orgId,
      locationId: opts.locationId,
      workOrderId: wo.id,
      number: `INV-${opts.number}`,
      status: "PAID",
      currency: "USD",
      subtotalMinor: 100n,
      discountMinor: 0n,
      taxMinor: 0n,
      totalMinor: 100n,
      paidMinor: 100n,
      issuedAt: opts.issuedAt,
      warrantyMonths: opts.warrantyMonths,
      warrantyMiles: opts.warrantyMiles,
    },
  });
}

describe("invoice warranty (#239)", { skip: shouldSkip }, () => {
  it("copies org defaults onto a new invoice", async () => {
    const { createInvoiceFromWorkOrder } = await import("@/modules/invoices/invoice-service");
    const seed = await seedShop("Defaults");
    const wo = await dbModule.db.workOrder.create({
      data: {
        organizationId: seed.orgId,
        locationId: seed.locationId,
        customerId: seed.customerId,
        assetId: seed.assetId,
        number: "RO-6001",
        customerConcern: "d",
        status: "AUTHORIZED",
      },
    });
    const revision = await dbModule.db.estimateRevision.create({
      data: {
        organizationId: seed.orgId,
        locationId: seed.locationId,
        workOrderId: wo.id,
        revisionNumber: 1,
        status: "PRESENTED",
        documentKind: "BASELINE",
        currency: "USD",
        subtotalMinor: 0n,
        discountMinor: 0n,
        taxMinor: 0n,
        totalMinor: 0n,
        presentedAt: new Date(),
      },
    });
    const line = await dbModule.db.estimateLine.create({
      data: {
        organizationId: seed.orgId,
        estimateRevisionId: revision.id,
        serviceGroupKey: "general",
        kind: "LABOR",
        description: "work",
        quantityMilli: 1000,
        unitPriceMinor: 100n,
        grossMinor: 100n,
        discountMinor: 0n,
        taxable: false,
        taxRateBasisPoints: 0,
        taxMinor: 0n,
        totalMinor: 100n,
        position: 1,
      },
    });
    const { recordAuthorization } = await import("@/modules/estimates/authorization-service");
    await recordAuthorization({
      db: dbModule.db,
      context: seed.context(),
      revisionId: revision.id,
      method: "IN_PERSON",
      providedByName: "Customer",
      decisions: [{ estimateLineId: line.id, decision: "APPROVED" }],
    });

    const invoice = await createInvoiceFromWorkOrder({
      db: dbModule.db,
      context: seed.context(),
      workOrderId: wo.id,
    });
    const created = await dbModule.db.invoice.findUnique({ where: { id: invoice.invoiceId } });
    expect(created?.warrantyMonths).toBe(24);
    expect(created?.warrantyMiles).toBe(24_000);
  });

  it("edits terms on a DRAFT invoice and freezes them at issue", async () => {
    const { setInvoiceWarranty } = await import("@/modules/invoices/warranty-service");
    const seed = await seedShop("Edit");
    const invoice = await dbModule.db.invoice.create({
      data: {
        organizationId: seed.orgId,
        locationId: seed.locationId,
        workOrderId: (
          await dbModule.db.workOrder.create({
            data: {
              organizationId: seed.orgId,
              locationId: seed.locationId,
              customerId: seed.customerId,
              number: "RO-6002",
              customerConcern: "d",
              status: "COMPLETED",
            },
          })
        ).id,
        number: "INV-6002",
        status: "DRAFT",
        currency: "USD",
        subtotalMinor: 0n,
        discountMinor: 0n,
        taxMinor: 0n,
        totalMinor: 0n,
        paidMinor: 0n,
      },
    });

    await setInvoiceWarranty({
      db: dbModule.db,
      context: seed.context(),
      invoiceId: invoice.id,
      warrantyMonths: 12,
      warrantyMiles: 12_000,
    });
    await setInvoiceWarranty({
      db: dbModule.db,
      context: seed.context(),
      invoiceId: invoice.id,
      warrantyMonths: null,
      warrantyMiles: 36_000,
    });
    await expect(
      setInvoiceWarranty({
        db: dbModule.db,
        context: seed.context(),
        invoiceId: invoice.id,
        warrantyMonths: 0,
      }),
    ).rejects.toMatchObject({ reason: "invalid_terms" });

    await dbModule.db.invoice.update({
      where: { id: invoice.id },
      data: { status: "ISSUED", issuedAt: new Date() },
    });
    await expect(
      setInvoiceWarranty({
        db: dbModule.db,
        context: seed.context(),
        invoiceId: invoice.id,
        warrantyMonths: 48,
      }),
    ).rejects.toMatchObject({ reason: "invoice_not_draft" });
  });

  it("surfaces active coverage and drops expired work for the asset", async () => {
    const { activeWarrantyForAsset } = await import("@/modules/invoices/warranty-service");
    const seed = await seedShop("Coverage");
    const now = new Date("2026-08-21T00:00:00Z");
    await issuedWarrantyInvoice({
      ...seed,
      number: "6010",
      issuedAt: new Date("2026-02-01T00:00:00Z"),
      warrantyMonths: 24,
      warrantyMiles: 24_000,
    });
    await issuedWarrantyInvoice({
      ...seed,
      number: "6011",
      issuedAt: new Date("2024-01-01T00:00:00Z"),
      warrantyMonths: 12,
      warrantyMiles: null,
    });
    await issuedWarrantyInvoice({
      ...seed,
      number: "6012",
      issuedAt: new Date("2026-07-01T00:00:00Z"),
      warrantyMonths: null,
      warrantyMiles: 5_000,
    });

    const coverage = await activeWarrantyForAsset({
      db: dbModule.db,
      context: seed.context(),
      assetId: seed.assetId,
      now,
    });
    expect(coverage.map((row) => row.workOrderNumber)).toEqual(["6012", "6010"]);
    const activeRow = coverage.find((row) => row.workOrderNumber === "6010")!;
    expect(activeRow.expiresAt?.toISOString()).toBe("2028-02-01T00:00:00.000Z");
    expect(activeRow.lastKnownMileage).toBe(68_400);
    const milesOnly = coverage.find((row) => row.workOrderNumber === "6012")!;
    expect(milesOnly.expiresAt).toBeNull();
  });

  it("never leaks another organization's coverage", async () => {
    const { activeWarrantyForAsset } = await import("@/modules/invoices/warranty-service");
    const seedA = await seedShop("CovA");
    const seedB = await seedShop("CovB");
    await issuedWarrantyInvoice({
      ...seedA,
      number: "6020",
      issuedAt: new Date("2026-08-01T00:00:00Z"),
      warrantyMonths: 24,
      warrantyMiles: null,
    });

    const foreign = await activeWarrantyForAsset({
      db: dbModule.db,
      context: seedB.context(),
      assetId: seedA.assetId,
    });
    expect(foreign).toEqual([]);
  });
});
