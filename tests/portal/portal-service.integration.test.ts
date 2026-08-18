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

async function seedShop() {
  const orgId = randomUUID();
  const otherOrgId = randomUUID();
  const locationId = randomUUID();
  const portalUserId = randomUUID();
  const strangerUserId = randomUUID();

  await dbModule.db.$transaction([
    dbModule.db.organization.create({
      data: { id: orgId, slug: `org-${orgId.slice(0, 8)}`, name: "Portal Garage" },
    }),
    dbModule.db.organization.create({
      data: { id: otherOrgId, slug: `other-${otherOrgId.slice(0, 8)}`, name: "Other Garage" },
    }),
    dbModule.db.location.create({
      data: { id: locationId, organizationId: orgId, code: "MAIN", name: "Main", timeZone: "UTC" },
    }),
    dbModule.db.user.create({
      data: {
        id: portalUserId,
        email: `p-${portalUserId.slice(0, 8)}@example.test`,
        displayName: "Linked Customer",
      },
    }),
    dbModule.db.user.create({
      data: {
        id: strangerUserId,
        email: `s-${strangerUserId.slice(0, 8)}@example.test`,
        displayName: "Stranger",
      },
    }),
  ]);

  async function addCustomer(input: {
    id: string;
    orgId: string;
    name: string;
    portalUserId?: string;
    archivedAt?: Date;
  }) {
    await dbModule.db.customer.create({
      data: {
        id: input.id,
        organizationId: input.orgId,
        kind: "INDIVIDUAL",
        displayName: input.name,
        ...(input.portalUserId ? { portalUserId: input.portalUserId } : {}),
        ...(input.archivedAt ? { archivedAt: input.archivedAt } : {}),
      },
    });
  }

  async function addWorkOrder(input: {
    id: string;
    customerId: string;
    orgId: string;
    number: string;
    trackerToken?: string;
  }) {
    await dbModule.db.workOrder.create({
      data: {
        id: input.id,
        organizationId: input.orgId,
        locationId,
        customerId: input.customerId,
        number: input.number,
        customerConcern: `Portal test ${input.number}`,
        ...(input.trackerToken
          ? { trackerLink: { create: { id: randomUUID(), token: input.trackerToken } } }
          : {}),
      },
    });
  }

  return { orgId, otherOrgId, portalUserId, strangerUserId, addCustomer, addWorkOrder };
}

describe("customer portal (#180)", { skip: shouldSkip }, () => {
  it("lists only linked customers in active organizations", async () => {
    const portal = await import("@/modules/portal/portal-service");
    const seed = await seedShop();

    const linkedCustomerId = randomUUID();
    const otherOrgCustomerId = randomUUID();
    const archivedCustomerId = randomUUID();
    await seed.addCustomer({
      id: linkedCustomerId,
      orgId: seed.orgId,
      name: "Linked Here",
      portalUserId: seed.portalUserId,
    });
    await seed.addCustomer({
      id: otherOrgCustomerId,
      orgId: seed.otherOrgId,
      name: "Linked There",
      portalUserId: seed.portalUserId,
    });
    await seed.addCustomer({
      id: archivedCustomerId,
      orgId: seed.orgId,
      name: "Old Link",
      portalUserId: seed.portalUserId,
      archivedAt: new Date(),
    });

    const links = await portal.resolvePortalLinks(dbModule.db, seed.portalUserId);
    // Ordered by organization name: "Other Garage" sorts before "Portal Garage".
    expect(links.map((link) => link.customerName)).toEqual(["Linked There", "Linked Here"]);
    expect(links.every((link) => link.customerId !== archivedCustomerId)).toBe(true);

    // A user with no links sees nothing — and no errors.
    expect(await portal.resolvePortalLinks(dbModule.db, seed.strangerUserId)).toHaveLength(0);
  });

  it("resolves one customer per organization and none where unlinked", async () => {
    const portal = await import("@/modules/portal/portal-service");
    const seed = await seedShop();

    const customerId = randomUUID();
    await seed.addCustomer({
      id: customerId,
      orgId: seed.orgId,
      name: "Linked Here",
      portalUserId: seed.portalUserId,
    });

    const resolved = await portal.resolvePortalCustomer(dbModule.db, seed.portalUserId, seed.orgId);
    expect(resolved?.customerId).toBe(customerId);

    // Same user, different organization → no link, no data.
    expect(
      await portal.resolvePortalCustomer(dbModule.db, seed.portalUserId, seed.otherOrgId),
    ).toBeNull();
    // Different user, same organization → no link.
    expect(
      await portal.resolvePortalCustomer(dbModule.db, seed.strangerUserId, seed.orgId),
    ).toBeNull();
  });

  it("shows only the linked customer's visits, vehicles, and invoices — never another customer's", async () => {
    const portal = await import("@/modules/portal/portal-service");
    const seed = await seedShop();

    const linkedCustomerId = randomUUID();
    const neighborCustomerId = randomUUID();
    await seed.addCustomer({
      id: linkedCustomerId,
      orgId: seed.orgId,
      name: "Linked",
      portalUserId: seed.portalUserId,
    });
    await seed.addCustomer({ id: neighborCustomerId, orgId: seed.orgId, name: "Neighbor" });

    await seed.addWorkOrder({
      id: randomUUID(),
      customerId: linkedCustomerId,
      orgId: seed.orgId,
      number: "RO-9001",
      trackerToken: "portal-tracker-token",
    });
    const neighborWorkOrderId = randomUUID();
    await seed.addWorkOrder({
      id: neighborWorkOrderId,
      customerId: neighborCustomerId,
      orgId: seed.orgId,
      number: "RO-9002",
    });

    await dbModule.db.asset.create({
      data: {
        id: randomUUID(),
        organizationId: seed.orgId,
        customerId: linkedCustomerId,
        displayName: "My Civic",
        category: "automobile",
      },
    });
    await dbModule.db.asset.create({
      data: {
        id: randomUUID(),
        organizationId: seed.orgId,
        customerId: neighborCustomerId,
        displayName: "Neighbor Truck",
        category: "truck",
      },
    });

    // Invoices: one per customer, both issued.
    const [linkedWorkOrder] = await dbModule.db.workOrder.findMany({
      where: { customerId: linkedCustomerId },
      select: { id: true },
    });
    const invoiceIds = { linked: randomUUID(), neighbor: randomUUID() };
    await dbModule.db.$transaction([
      dbModule.db.invoice.create({
        data: {
          id: invoiceIds.linked,
          organizationId: seed.orgId,
          locationId: (await dbModule.db.location.findFirst({
            where: { organizationId: seed.orgId },
          }))!.id,
          workOrderId: linkedWorkOrder!.id,
          number: "INV-P1",
          status: "ISSUED",
          currency: "USD",
          subtotalMinor: 100_00n,
          discountMinor: 0n,
          taxMinor: 0n,
          totalMinor: 100_00n,
          paidMinor: 0n,
          issuedAt: new Date(),
        },
      }),
      dbModule.db.invoice.create({
        data: {
          id: invoiceIds.neighbor,
          organizationId: seed.orgId,
          locationId: (await dbModule.db.location.findFirst({
            where: { organizationId: seed.orgId },
          }))!.id,
          workOrderId: neighborWorkOrderId,
          number: "INV-P2",
          status: "ISSUED",
          currency: "USD",
          subtotalMinor: 500_00n,
          discountMinor: 0n,
          taxMinor: 0n,
          totalMinor: 500_00n,
          paidMinor: 0n,
          issuedAt: new Date(),
        },
      }),
    ]);

    const view = await portal.getPortalShopView(dbModule.db, seed.portalUserId, seed.orgId);
    expect(view).not.toBeNull();
    expect(view?.customer.customerId).toBe(linkedCustomerId);
    expect(view?.workOrders.map((wo) => wo.number)).toEqual(["RO-9001"]);
    expect(view?.workOrders[0]?.trackerToken).toBe("portal-tracker-token");
    expect(view?.vehicles.map((vehicle) => vehicle.displayName)).toEqual(["My Civic"]);
    expect(view?.invoices.map((invoice) => invoice.number)).toEqual(["INV-P1"]);
    expect(view?.statement?.balanceMinor).toBe(100_00n);
    const serialized = JSON.stringify(view, (_key, value: unknown) =>
      typeof value === "bigint" ? value.toString() : value,
    );
    expect(serialized).not.toContain("Neighbor");
    expect(serialized).not.toContain("INV-P2");

    // Unlinked user in the same organization gets nothing at all.
    expect(await portal.getPortalShopView(dbModule.db, seed.strangerUserId, seed.orgId)).toBeNull();
  });
});
