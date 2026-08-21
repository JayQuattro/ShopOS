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
      data: { id: orgId, slug: `org-${orgId.slice(0, 8)}`, name, defaultCurrency: "USD" },
    }),
    dbModule.db.location.create({
      data: { id: locationId, organizationId: orgId, code: "MAIN", name: "Main", timeZone: "UTC" },
    }),
    dbModule.db.user.create({
      data: {
        id: userId,
        email: `s-${userId.slice(0, 8)}@example.test`,
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

type JobSpec = Readonly<{
  groupKey: string;
  groupLabel: string;
  lines: ReadonlyArray<{ description: string; linkedItem: boolean }>;
}>;

/** DRAFT invoice with grouped lines carrying source estimate lineage. */
async function draftGroupedInvoice(opts: {
  orgId: string;
  locationId: string;
  customerId: string;
  assetId: string;
  number: string;
  jobs: readonly JobSpec[];
}) {
  const wo = await dbModule.db.workOrder.create({
    data: {
      organizationId: opts.orgId,
      locationId: opts.locationId,
      customerId: opts.customerId,
      assetId: opts.assetId,
      number: opts.number,
      customerConcern: "grouped work",
      status: "AUTHORIZED",
    },
  });
  const revision = await dbModule.db.estimateRevision.create({
    data: {
      organizationId: opts.orgId,
      locationId: opts.locationId,
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
  const invoice = await dbModule.db.invoice.create({
    data: {
      organizationId: opts.orgId,
      locationId: opts.locationId,
      workOrderId: wo.id,
      number: `INV-${opts.number}`,
      status: "DRAFT",
      currency: "USD",
      subtotalMinor: 0n,
      discountMinor: 0n,
      taxMinor: 0n,
      totalMinor: 0n,
      paidMinor: 0n,
    },
  });
  let estimatePosition = 0;
  let invoicePosition = 0;
  const invoiceLineIds: string[] = [];
  for (const job of opts.jobs) {
    for (const spec of job.lines) {
      estimatePosition += 1;
      const estimateLine = await dbModule.db.estimateLine.create({
        data: {
          organizationId: opts.orgId,
          estimateRevisionId: revision.id,
          serviceGroupKey: job.groupKey,
          serviceGroupLabel: job.groupLabel,
          kind: "PART",
          description: spec.description,
          quantityMilli: 1000,
          unitPriceMinor: 100n,
          grossMinor: 100n,
          discountMinor: 0n,
          taxable: false,
          taxRateBasisPoints: 0,
          taxMinor: 0n,
          totalMinor: 100n,
          position: estimatePosition,
        },
      });
      invoicePosition += 1;
      const invoiceLine = await dbModule.db.invoiceLine.create({
        data: {
          organizationId: opts.orgId,
          invoiceId: invoice.id,
          sourceEstimateLineId: estimateLine.id,
          kind: "PART",
          description: spec.description,
          quantityMilli: 1000,
          unitPriceMinor: 100n,
          grossMinor: 100n,
          discountMinor: 0n,
          taxable: false,
          taxRateBasisPoints: 0,
          taxMinor: 0n,
          totalMinor: 100n,
          position: invoicePosition,
        },
      });
      invoiceLineIds.push(invoiceLine.id);
    }
  }
  return { invoice, wo, invoiceLineIds };
}

describe("per-job warranty and disclaimer scope (#240)", { skip: shouldSkip }, () => {
  it("sets per-line warranty terms and derives per-job coverage with invoice fallback", async () => {
    const { setInvoiceWarranty, activeWarrantyForAsset } =
      await import("@/modules/invoices/warranty-service");
    const seed = await seedShop("PerJob");
    const { invoice, invoiceLineIds } = await draftGroupedInvoice({
      ...seed,
      number: "7001",
      jobs: [
        {
          groupKey: "front-brakes",
          groupLabel: "Front brakes",
          lines: [{ description: "rotors", linkedItem: false }],
        },
        {
          groupKey: "oil-change",
          groupLabel: "Oil change",
          lines: [{ description: "oil", linkedItem: false }],
        },
      ],
    });

    // Brakes get their own terms; oil change inherits the invoice default.
    await setInvoiceWarranty({
      db: dbModule.db,
      context: seed.context(),
      invoiceId: invoice.id,
      warrantyMonths: 3,
      warrantyMiles: 5_000,
      lines: [
        { lineId: invoiceLineIds[0]!, warrantyMonths: 24, warrantyMiles: 24_000 },
        { lineId: invoiceLineIds[1]!, warrantyMonths: null, warrantyMiles: null },
      ],
    });
    await dbModule.db.invoice.update({
      where: { id: invoice.id },
      data: { status: "PAID", issuedAt: new Date("2026-08-01T00:00:00Z") },
    });

    const coverage = await activeWarrantyForAsset({
      db: dbModule.db,
      context: seed.context(),
      assetId: seed.assetId,
      now: new Date("2026-08-21T00:00:00Z"),
    });

    const byJob = new Map(coverage.map((row) => [row.jobLabel, row]));
    expect(byJob.get("Front brakes")).toMatchObject({
      warrantyMonths: 24,
      warrantyMiles: 24_000,
      workOrderNumber: "7001",
    });
    expect(byJob.get("Whole invoice")).toMatchObject({
      warrantyMonths: 3,
      warrantyMiles: 5_000,
    });
    expect(coverage).toHaveLength(2);
  });

  it("freezes per-line terms at issue", async () => {
    const { setInvoiceWarranty } = await import("@/modules/invoices/warranty-service");
    const seed = await seedShop("FreezeLine");
    const { invoice, invoiceLineIds } = await draftGroupedInvoice({
      ...seed,
      number: "7002",
      jobs: [
        {
          groupKey: "tune-up",
          groupLabel: "Tune up",
          lines: [{ description: "plugs", linkedItem: false }],
        },
      ],
    });
    await dbModule.db.invoice.update({
      where: { id: invoice.id },
      data: { status: "ISSUED", issuedAt: new Date() },
    });
    await expect(
      setInvoiceWarranty({
        db: dbModule.db,
        context: seed.context(),
        invoiceId: invoice.id,
        warrantyMonths: 12,
        lines: [{ lineId: invoiceLineIds[0]!, warrantyMonths: 6 }],
      }),
    ).rejects.toMatchObject({ reason: "invoice_not_draft" });
  });

  it("attaches disclaimers to a job or a line and snapshots the scope label", async () => {
    const { applyDisclaimer, listApplied } = await import("@/modules/invoices/disclaimer-service");
    const seed = await seedShop("Scoped");
    const { invoice, invoiceLineIds } = await draftGroupedInvoice({
      ...seed,
      number: "7003",
      jobs: [
        {
          groupKey: "front-brakes",
          groupLabel: "Front brakes",
          lines: [
            { description: "customer rotors", linkedItem: false },
            { description: "labor", linkedItem: false },
          ],
        },
      ],
    });

    await applyDisclaimer({
      db: dbModule.db,
      context: seed.context(),
      invoiceId: invoice.id,
      name: "Customer parts",
      body: "Labor-only warranty.",
      serviceGroupKey: "front-brakes",
    });
    await applyDisclaimer({
      db: dbModule.db,
      context: seed.context(),
      invoiceId: invoice.id,
      name: "Line note",
      body: "Specific to the rotors.",
      invoiceLineId: invoiceLineIds[0]!,
    });
    await applyDisclaimer({
      db: dbModule.db,
      context: seed.context(),
      invoiceId: invoice.id,
      name: "Shop policy",
      body: "Invoice wide.",
    });

    const applied = await listApplied({
      db: dbModule.db,
      context: seed.context(),
      invoiceId: invoice.id,
    });
    const scopes = new Map(applied.map((row) => [row.name, row.scope]));
    expect(scopes.get("Customer parts")).toBe("Front brakes");
    expect(scopes.get("Line note")).toBe("customer rotors");
    expect(scopes.get("Shop policy")).toBe("Whole invoice");

    // A scope referencing another invoice's line is rejected.
    const foreign = await seedShop("Foreign");
    const foreignInvoice = await draftGroupedInvoice({
      ...foreign,
      number: "7004",
      jobs: [
        {
          groupKey: "other",
          groupLabel: "Other",
          lines: [{ description: "x", linkedItem: false }],
        },
      ],
    });
    await expect(
      applyDisclaimer({
        db: dbModule.db,
        context: seed.context(),
        invoiceId: invoice.id,
        name: "Bad scope",
        body: "Nope",
        invoiceLineId: foreignInvoice.invoiceLineIds[0]!,
      }),
    ).rejects.toBeTruthy();
  });

  it("job-scoped suggestions stay invoice-wide suggestions — scope is chosen at apply", async () => {
    const { createTemplate, suggestedForInvoice } =
      await import("@/modules/invoices/disclaimer-service");
    const seed = await seedShop("SuggestScope");
    const { invoice } = await draftGroupedInvoice({
      ...seed,
      number: "7005",
      jobs: [
        {
          groupKey: "front-brakes",
          groupLabel: "Front brakes",
          lines: [{ description: "customer rotors", linkedItem: false }],
        },
      ],
    });
    await createTemplate({
      db: dbModule.db,
      context: seed.context(),
      name: "Customer-supplied parts",
      body: "Labor-only warranty.",
      triggerKey: "CUSTOMER_PARTS",
    });
    const suggestions = await suggestedForInvoice({
      db: dbModule.db,
      context: seed.context(),
      invoiceId: invoice.id,
    });
    expect(suggestions).toHaveLength(1);
  });
});
