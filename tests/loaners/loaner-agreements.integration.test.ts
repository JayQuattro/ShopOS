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
  const userId = randomUUID();
  const portalUserId = randomUUID();
  const membershipId = randomUUID();
  const roleId = randomUUID();
  const customerId = randomUUID();
  const workOrderId = randomUUID();
  const vanId = randomUUID();

  await dbModule.db.$transaction([
    dbModule.db.organization.create({
      data: { id: orgId, slug: `org-${orgId.slice(0, 8)}`, name: "Agreement Org" },
    }),
    dbModule.db.organization.create({
      data: { id: otherOrgId, slug: `o-${otherOrgId.slice(0, 8)}`, name: "Other Org" },
    }),
    dbModule.db.location.create({
      data: { id: locationId, organizationId: orgId, code: "MAIN", name: "Main", timeZone: "UTC" },
    }),
    dbModule.db.user.create({
      data: { id: userId, email: `ag-${userId.slice(0, 8)}@example.test`, displayName: "Loaner Desk" },
    }),
    dbModule.db.user.create({
      data: { id: portalUserId, email: `pg-${portalUserId.slice(0, 8)}@example.test`, displayName: "Portal Customer" },
    }),
    dbModule.db.organizationMembership.create({
      data: { id: membershipId, organizationId: orgId, userId, organizationWideLocationAccess: true },
    }),
    dbModule.db.role.create({
      data: {
        id: roleId,
        organizationId: orgId,
        key: "owner",
        name: "Owner",
        permissions: ["work_orders.write", "work_orders.read"],
      },
    }),
    dbModule.db.membershipRole.create({ data: { organizationId: orgId, membershipId, roleId } }),
    dbModule.db.customer.create({
      data: {
        id: customerId,
        organizationId: orgId,
        kind: "INDIVIDUAL",
        displayName: "Agreement Customer",
        portalUserId,
      },
    }),
    dbModule.db.workOrder.create({
      data: {
        id: workOrderId,
        organizationId: orgId,
        locationId,
        customerId,
        number: "RO-AG1",
        customerConcern: "agreement test",
        status: "IN_PROGRESS",
      },
    }),
    dbModule.db.asset.create({
      data: { id: vanId, organizationId: orgId, customerId, displayName: "Loaner Van", category: "van", isFleetVehicle: true },
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
      permissions: new Set(["work_orders.write", "work_orders.read"]),
    }) as import("@/modules/tenancy/policy").TenantContext;

  return { orgId, otherOrgId, customerId, workOrderId, vanId, portalUserId, context };
}

describe("loaner agreements + portal view (#211)", { skip: shouldSkip }, () => {
  it("records fuel, condition, and acknowledgment at check-out", async () => {
    const loaners = await import("@/modules/loaners/loaner-service");
    const seed = await seedShop();

    const { checkoutId } = await loaners.checkOutLoaner({
      db: dbModule.db,
      context: seed.context(),
      workOrderId: seed.workOrderId,
      assetId: seed.vanId,
      outMileage: 45_100,
      fuelOut: 75,
      conditionNote: "Scratch on rear door; full tank promised back",
      acknowledgedBy: "Maria Chen",
    });

    const row = await dbModule.db.loanerCheckout.findUnique({
      where: { id: checkoutId },
      select: { fuelOut: true, conditionNote: true, acknowledgedBy: true, acknowledgedAt: true },
    });
    expect(row?.fuelOut).toBe(75);
    expect(row?.conditionNote).toBe("Scratch on rear door; full tank promised back");
    expect(row?.acknowledgedBy).toBe("Maria Chen");
    expect(row?.acknowledgedAt).not.toBeNull();

    // The summary surfaces the agreement for dispute settlement.
    const summaries = await loaners.listOpenLoaners({ db: dbModule.db, context: seed.context() });
    expect(summaries[0]?.fuelOut).toBe(75);
    expect(summaries[0]?.acknowledgedBy).toBe("Maria Chen");
  });

  it("rejects fuel outside 0-100", async () => {
    const loaners = await import("@/modules/loaners/loaner-service");
    const seed = await seedShop();

    await expect(
      loaners.checkOutLoaner({
        db: dbModule.db,
        context: seed.context(),
        workOrderId: seed.workOrderId,
        assetId: seed.vanId,
        fuelOut: 120,
      }),
    ).rejects.toMatchObject({ reason: "invalid_mileage" });
  });

  it("shows the loaner in the customer's portal view — only their own", async () => {
    const portal = await import("@/modules/portal/portal-service");
    const loaners = await import("@/modules/loaners/loaner-service");
    const seed = await seedShop();

    // No loaner yet.
    let view = await portal.getPortalShopView(dbModule.db, seed.portalUserId, seed.orgId);
    expect(view?.loaner).toBeNull();

    await loaners.checkOutLoaner({
      db: dbModule.db,
      context: seed.context(),
      workOrderId: seed.workOrderId,
      assetId: seed.vanId,
      fuelOut: 50,
      conditionNote: "Clean at hand-off",
    });

    view = await portal.getPortalShopView(dbModule.db, seed.portalUserId, seed.orgId);
    expect(view?.loaner).toMatchObject({
      assetName: "Loaner Van",
      fuelOut: 50,
      conditionNote: "Clean at hand-off",
    });

    // Checking in clears it.
    await loaners.checkInLoaner({
      db: dbModule.db,
      context: seed.context(),
      checkoutId: (
        await dbModule.db.loanerCheckout.findFirst({
          where: { workOrderId: seed.workOrderId },
          select: { id: true },
        })
      )!.id,
    });
    view = await portal.getPortalShopView(dbModule.db, seed.portalUserId, seed.orgId);
    expect(view?.loaner).toBeNull();
  });
});
