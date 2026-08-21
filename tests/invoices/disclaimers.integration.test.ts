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
        email: `d-${userId.slice(0, 8)}@example.test`,
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
  ]);

  return {
    orgId,
    locationId,
    userId,
    customerId,
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

/** A DRAFT invoice on a completed work order. */
async function draftInvoice(opts: {
  orgId: string;
  locationId: string;
  customerId: string;
  number: string;
  lines?: ReadonlyArray<{ kind: "PART" | "LABOR"; linked: boolean }>;
}) {
  const wo = await dbModule.db.workOrder.create({
    data: {
      organizationId: opts.orgId,
      locationId: opts.locationId,
      customerId: opts.customerId,
      number: opts.number,
      customerConcern: "d",
      status: "COMPLETED",
    },
  });
  const item = await dbModule.db.inventoryItem.create({
    data: {
      organizationId: opts.orgId,
      partNumber: `DK-${opts.number}`,
      name: "Stocked",
      quantityOnHand: 5,
      unitCostMinor: 100n,
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
  let position = 0;
  for (const line of opts.lines ?? [{ kind: "PART", linked: false }]) {
    position += 1;
    await dbModule.db.invoiceLine.create({
      data: {
        organizationId: opts.orgId,
        invoiceId: invoice.id,
        kind: line.kind,
        description: "line",
        quantityMilli: 1000,
        unitPriceMinor: 100n,
        grossMinor: 100n,
        discountMinor: 0n,
        taxable: false,
        taxRateBasisPoints: 0,
        taxMinor: 0n,
        totalMinor: 100n,
        position,
        ...(line.linked ? { inventoryItemId: item.id } : {}),
      },
    });
  }
  return { invoice, wo };
}

describe("invoice disclaimers (#238)", { skip: shouldSkip }, () => {
  it("creates and lists templates, rejecting duplicates", async () => {
    const { createTemplate, listTemplates } = await import("@/modules/invoices/disclaimer-service");
    const seed = await seedShop("Tpl");
    await createTemplate({
      db: dbModule.db,
      context: seed.context(),
      name: "Customer-supplied parts",
      body: "Labor-only warranty when the customer supplies parts.",
      triggerKey: "CUSTOMER_PARTS",
    });
    await createTemplate({
      db: dbModule.db,
      context: seed.context(),
      name: "Storage policy",
      body: "Vehicles left over 30 days may incur storage fees.",
    });
    await expect(
      createTemplate({
        db: dbModule.db,
        context: seed.context(),
        name: "Storage policy",
        body: "Duplicate",
      }),
    ).rejects.toMatchObject({ reason: "duplicate_name" });

    const templates = await listTemplates({ db: dbModule.db, context: seed.context() });
    expect(templates).toHaveLength(2);
    expect(templates.map((t) => t.triggerKey).sort()).toEqual(["CUSTOMER_PARTS", null]);
  });

  it("suggests the customer-parts disclaimer only for unlinked part lines", async () => {
    const { createTemplate, suggestedForInvoice } =
      await import("@/modules/invoices/disclaimer-service");
    const seed = await seedShop("Suggest");
    const template = await createTemplate({
      db: dbModule.db,
      context: seed.context(),
      name: "Customer-supplied parts",
      body: "Labor-only warranty.",
      triggerKey: "CUSTOMER_PARTS",
    });

    const unlinked = await draftInvoice({
      ...seed,
      number: "5001",
      lines: [{ kind: "PART", linked: false }],
    });
    const suggestions = await suggestedForInvoice({
      db: dbModule.db,
      context: seed.context(),
      invoiceId: unlinked.invoice.id,
    });
    expect(suggestions.map((t) => t.id)).toEqual([template.templateId]);

    const linked = await draftInvoice({
      ...seed,
      number: "5002",
      lines: [{ kind: "PART", linked: true }],
    });
    const none = await suggestedForInvoice({
      db: dbModule.db,
      context: seed.context(),
      invoiceId: linked.invoice.id,
    });
    expect(none).toEqual([]);
  });

  it("suggests the sublet disclaimer when the job has sublet work", async () => {
    const { createTemplate, suggestedForInvoice } =
      await import("@/modules/invoices/disclaimer-service");
    const seed = await seedShop("Sublet");
    await createTemplate({
      db: dbModule.db,
      context: seed.context(),
      name: "Sublet work",
      body: "Sublet work is performed by a third-party specialist.",
      triggerKey: "SUBLET",
    });
    const { invoice, wo } = await draftInvoice({ ...seed, number: "5003", lines: [] });
    await dbModule.db.subletWork.create({
      data: {
        organizationId: seed.orgId,
        locationId: seed.locationId,
        workOrderId: wo.id,
        vendorName: "Machine shop",
        description: "Resurface rotors",
      },
    });

    const suggestions = await suggestedForInvoice({
      db: dbModule.db,
      context: seed.context(),
      invoiceId: invoice.id,
    });
    expect(suggestions.map((t) => t.name)).toEqual(["Sublet work"]);
  });

  it("snapshots a template into the invoice and freezes on issue", async () => {
    const { createTemplate, applyDisclaimer, removeDisclaimer, listApplied } =
      await import("@/modules/invoices/disclaimer-service");
    const seed = await seedShop("Snapshot");
    const template = await createTemplate({
      db: dbModule.db,
      context: seed.context(),
      name: "Repair warranty",
      body: "24 months / 24,000 miles.",
    });
    const { invoice } = await draftInvoice({ ...seed, number: "5004", lines: [] });

    await applyDisclaimer({
      db: dbModule.db,
      context: seed.context(),
      invoiceId: invoice.id,
      templateId: template.templateId,
    });
    // Library edit after applying does not rewrite the snapshot.
    await dbModule.db.disclaimerTemplate.update({
      where: { id: template.templateId },
      data: { body: "changed later" },
    });
    const applied = await listApplied({
      db: dbModule.db,
      context: seed.context(),
      invoiceId: invoice.id,
    });
    expect(applied[0]!.body).toBe("24 months / 24,000 miles.");

    await dbModule.db.invoice.update({
      where: { id: invoice.id },
      data: { status: "ISSUED", issuedAt: new Date() },
    });
    await expect(
      removeDisclaimer({
        db: dbModule.db,
        context: seed.context(),
        invoiceId: invoice.id,
        disclaimerId: applied[0]!.id,
      }),
    ).rejects.toMatchObject({ reason: "invoice_not_draft" });
    await expect(
      applyDisclaimer({
        db: dbModule.db,
        context: seed.context(),
        invoiceId: invoice.id,
        name: "Late",
        body: "Too late",
      }),
    ).rejects.toMatchObject({ reason: "invoice_not_draft" });
  });

  it("excludes already-applied names from suggestions and never crosses tenants", async () => {
    const { createTemplate, applyDisclaimer, suggestedForInvoice, listTemplates } =
      await import("@/modules/invoices/disclaimer-service");
    const seedA = await seedShop("IsoA");
    const seedB = await seedShop("IsoB");
    const template = await createTemplate({
      db: dbModule.db,
      context: seedA.context(),
      name: "Customer-supplied parts",
      body: "Labor-only warranty.",
      triggerKey: "CUSTOMER_PARTS",
    });
    const { invoice } = await draftInvoice({ ...seedA, number: "5005" });
    await applyDisclaimer({
      db: dbModule.db,
      context: seedA.context(),
      invoiceId: invoice.id,
      templateId: template.templateId,
    });

    // Applied → no longer suggested for this invoice.
    const suggestions = await suggestedForInvoice({
      db: dbModule.db,
      context: seedA.context(),
      invoiceId: invoice.id,
    });
    expect(suggestions).toEqual([]);

    // Another org sees neither the library nor this invoice's rows.
    const foreignTemplates = await listTemplates({ db: dbModule.db, context: seedB.context() });
    expect(foreignTemplates).toEqual([]);
    await expect(
      applyDisclaimer({
        db: dbModule.db,
        context: seedB.context(),
        invoiceId: invoice.id,
        name: "Sneaky",
        body: "Cross tenant",
      }),
    ).rejects.toMatchObject({ reason: "invoice_not_found" });
  });
});
