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

async function seedShop(input?: { orgPrefix?: string }) {
  const orgId = randomUUID();
  const locationA = randomUUID();
  const locationB = randomUUID();
  const userId = randomUUID();
  const membershipId = randomUUID();
  const roleId = randomUUID();
  const customerId = randomUUID();

  await dbModule.db.$transaction([
    dbModule.db.organization.create({
      data: {
        id: orgId,
        slug: `org-${orgId.slice(0, 8)}`,
        name: "Series Org",
        ...(input?.orgPrefix ? { invoiceNumberPrefix: input.orgPrefix } : {}),
      },
    }),
    dbModule.db.location.create({
      data: {
        id: locationA,
        organizationId: orgId,
        code: "A",
        name: "Location A",
        timeZone: "UTC",
      },
    }),
    dbModule.db.location.create({
      data: {
        id: locationB,
        organizationId: orgId,
        code: "B",
        name: "Location B",
        timeZone: "UTC",
      },
    }),
    dbModule.db.user.create({
      data: {
        id: userId,
        email: `se-${userId.slice(0, 8)}@example.test`,
        displayName: "Series User",
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
        permissions: ["work_orders.write", "invoices.issue", "payments.record"],
      },
    }),
    dbModule.db.membershipRole.create({ data: { organizationId: orgId, membershipId, roleId } }),
    dbModule.db.customer.create({
      data: {
        id: customerId,
        organizationId: orgId,
        kind: "INDIVIDUAL",
        displayName: "Series Customer",
      },
    }),
  ]);

  const context = () =>
    ({
      actorId: userId,
      organizationId: orgId,
      membershipId,
      requestId: randomUUID(),
      organizationWideLocationAccess: true,
      allowedLocationIds: new Set<string>(),
      permissions: new Set(["work_orders.write", "invoices.issue", "payments.record"]),
    }) as import("@/modules/tenancy/policy").TenantContext;

  async function addInvoicedWorkOrder(locationId: string, number: string) {
    const workOrderId = randomUUID();
    await dbModule.db.workOrder.create({
      data: {
        id: workOrderId,
        organizationId: orgId,
        locationId,
        customerId,
        number,
        customerConcern: "series test",
        status: "COMPLETED",
      },
    });
    return workOrderId;
  }

  return { orgId, locationA, locationB, context, addInvoicedWorkOrder };
}

describe("per-location invoice series + tax identity (#194)", { skip: shouldSkip }, () => {
  it("numbers each location independently — both may issue the same number", async () => {
    const invoiceService = await import("@/modules/invoices/invoice-service");
    const seed = await seedShop();

    const woA = await seed.addInvoicedWorkOrder(seed.locationA, "WO-A1");
    const woB = await seed.addInvoicedWorkOrder(seed.locationB, "WO-B1");

    const a1 = await invoiceService.createInvoiceFromWorkOrder({
      db: dbModule.db,
      context: seed.context(),
      workOrderId: woA,
    });
    const b1 = await invoiceService.createInvoiceFromWorkOrder({
      db: dbModule.db,
      context: seed.context(),
      workOrderId: woB,
    });
    const a2 = await invoiceService.createInvoiceFromWorkOrder({
      db: dbModule.db,
      context: seed.context(),
      workOrderId: await seed.addInvoicedWorkOrder(seed.locationA, "WO-A2"),
    });

    // Each location starts its own gapless series from the org prefix.
    expect(a1.number).toBe("INV-1001");
    expect(b1.number).toBe("INV-1001");
    expect(a2.number).toBe("INV-1002");
  });

  it("uses the location's series prefix when set, without disturbing siblings", async () => {
    const invoiceService = await import("@/modules/invoices/invoice-service");
    const seed = await seedShop({ orgPrefix: "INV-" });

    await dbModule.db.location.update({
      where: { id: seed.locationB },
      data: { invoiceNumberPrefix: "2026-B-" },
    });

    const b1 = await invoiceService.createInvoiceFromWorkOrder({
      db: dbModule.db,
      context: seed.context(),
      workOrderId: await seed.addInvoicedWorkOrder(seed.locationB, "WO-B1"),
    });
    const a1 = await invoiceService.createInvoiceFromWorkOrder({
      db: dbModule.db,
      context: seed.context(),
      workOrderId: await seed.addInvoicedWorkOrder(seed.locationA, "WO-A1"),
    });

    expect(b1.number).toBe("2026-B-1001");
    expect(a1.number).toBe("INV-1001"); // sibling keeps the org series
  });

  it("stores and clears tax registration ids on org and customer", async () => {
    const profile = await import("@/modules/organizations/org-profile-service");
    const customers = await import("@/modules/customers/customer-service");
    const seed = await seedShop();
    const manageContext = {
      ...seed.context(),
      permissions: new Set(["organizations.manage", "customers.write"]),
    } as import("@/modules/tenancy/policy").TenantContext;
    const context = manageContext;

    const customerId = randomUUID();
    await dbModule.db.customer.create({
      data: {
        id: customerId,
        organizationId: seed.orgId,
        kind: "BUSINESS",
        displayName: "GmbH Customer",
      },
    });

    await profile.updateShopProfile(dbModule.db, context, {
      name: "Series Org",
      taxId: "DE123456789",
    });
    let read = await profile.getShopProfile(dbModule.db, context);
    expect(read.taxId).toBe("DE123456789");

    await customers.updateCustomer({
      db: dbModule.db,
      context: manageContext,
      customerId,
      taxId: "FR98765432109",
    });
    expect(
      (
        await dbModule.db.customer.findUnique({
          where: { id: customerId },
          select: { taxId: true },
        })
      )?.taxId,
    ).toBe("FR98765432109");

    // Invalid org tax id rejected.
    await expect(
      profile.updateShopProfile(dbModule.db, context, { name: "Series Org", taxId: "!!!" }),
    ).rejects.toMatchObject({ reason: "invalid_tax_id" });

    // Clearing works.
    await profile.updateShopProfile(dbModule.db, context, { name: "Series Org", taxId: null });
    read = await profile.getShopProfile(dbModule.db, context);
    expect(read.taxId).toBeNull();
  });
});
