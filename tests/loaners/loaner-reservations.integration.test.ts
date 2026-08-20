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
  const membershipId = randomUUID();
  const roleId = randomUUID();
  const customerId = randomUUID();
  const workOrderId = randomUUID();
  const vanId = randomUUID();
  const truckId = randomUUID();
  const customerCarId = randomUUID();

  await dbModule.db.$transaction([
    dbModule.db.organization.create({
      data: { id: orgId, slug: `org-${orgId.slice(0, 8)}`, name: "Reservation Org" },
    }),
    dbModule.db.organization.create({
      data: { id: otherOrgId, slug: `o-${otherOrgId.slice(0, 8)}`, name: "Other Org" },
    }),
    dbModule.db.location.create({
      data: { id: locationId, organizationId: orgId, code: "MAIN", name: "Main", timeZone: "UTC" },
    }),
    dbModule.db.user.create({
      data: {
        id: userId,
        email: `lr-${userId.slice(0, 8)}@example.test`,
        displayName: "Loaner Desk",
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
        permissions: ["work_orders.write", "work_orders.read", "customers.read"],
      },
    }),
    dbModule.db.membershipRole.create({ data: { organizationId: orgId, membershipId, roleId } }),
    dbModule.db.customer.create({
      data: {
        id: customerId,
        organizationId: orgId,
        kind: "INDIVIDUAL",
        displayName: "Reservation Customer",
      },
    }),
    dbModule.db.workOrder.create({
      data: {
        id: workOrderId,
        organizationId: orgId,
        locationId,
        customerId,
        number: "RO-LR1",
        customerConcern: "reservation test",
        status: "IN_PROGRESS",
      },
    }),
    dbModule.db.asset.create({
      data: {
        id: vanId,
        organizationId: orgId,
        customerId,
        displayName: "Loaner Van",
        category: "van",
        isFleetVehicle: true,
      },
    }),
    dbModule.db.asset.create({
      data: {
        id: truckId,
        organizationId: orgId,
        customerId,
        displayName: "Service Truck",
        category: "truck",
        isFleetVehicle: true,
      },
    }),
    dbModule.db.asset.create({
      data: {
        id: customerCarId,
        organizationId: orgId,
        customerId,
        displayName: "Customer Car",
        category: "automobile",
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
      permissions: new Set<string>(permissions ?? ["work_orders.write", "work_orders.read"]),
    }) as import("@/modules/tenancy/policy").TenantContext;

  return {
    orgId,
    otherOrgId,
    locationId,
    customerId,
    workOrderId,
    vanId,
    truckId,
    customerCarId,
    context,
  };
}

const DAY = 24 * 60 * 60 * 1000;
const base = Date.UTC(2026, 8, 1); // Sep 1

describe("loaner reservations (#210)", { skip: shouldSkip }, () => {
  it("reserves windows, refuses overlaps, and allows touching windows", async () => {
    const reservations = await import("@/modules/loaners/loaner-reservation-service");
    const seed = await seedShop();

    await reservations.reserveLoaner({
      db: dbModule.db,
      context: seed.context(),
      assetId: seed.vanId,
      customerId: seed.customerId,
      locationId: seed.locationId,
      reservedFrom: new Date(base),
      reservedTo: new Date(base + 3 * DAY),
      note: "For the Tuesday drop-off",
    });

    // A different vehicle in the same window is fine.
    await reservations.reserveLoaner({
      db: dbModule.db,
      context: seed.context(),
      assetId: seed.truckId,
      customerId: seed.customerId,
      locationId: seed.locationId,
      reservedFrom: new Date(base + DAY),
      reservedTo: new Date(base + 2 * DAY),
    });

    // Overlapping the van's window is refused.
    await expect(
      reservations.reserveLoaner({
        db: dbModule.db,
        context: seed.context(),
        assetId: seed.vanId,
        customerId: seed.customerId,
        locationId: seed.locationId,
        reservedFrom: new Date(base + 2 * DAY),
        reservedTo: new Date(base + 4 * DAY),
      }),
    ).rejects.toMatchObject({ reason: "asset_already_reserved" });

    // A window touching the end boundary is allowed (half-open).
    await expect(
      reservations.reserveLoaner({
        db: dbModule.db,
        context: seed.context(),
        assetId: seed.vanId,
        customerId: seed.customerId,
        locationId: seed.locationId,
        reservedFrom: new Date(base + 3 * DAY),
        reservedTo: new Date(base + 5 * DAY),
      }),
    ).resolves.toBeDefined();

    // Listing shows both van windows plus the truck's, in order.
    const list = await reservations.listLoanerReservations({
      db: dbModule.db,
      context: seed.context(),
    });
    expect(list).toHaveLength(3);
    expect(list.map((r) => `${r.assetName}:${new Date(r.reservedFrom).getTime()}`)).toEqual([
      `Loaner Van:${base}`,
      `Service Truck:${base + DAY}`,
      `Loaner Van:${base + 3 * DAY}`,
    ]);
  });

  it("refuses non-fleet assets, vehicles already out, and cross-tenant actors", async () => {
    const reservations = await import("@/modules/loaners/loaner-reservation-service");
    const { TenantAccessDenied } = await import("@/modules/tenancy/policy");
    const seed = await seedShop();

    await expect(
      reservations.reserveLoaner({
        db: dbModule.db,
        context: seed.context(),
        assetId: seed.customerCarId,
        customerId: seed.customerId,
        locationId: seed.locationId,
        reservedFrom: new Date(base),
        reservedTo: new Date(base + DAY),
      }),
    ).rejects.toMatchObject({ reason: "asset_not_fleet" });

    // The van is checked out — no promises on it.
    await dbModule.db.loanerCheckout.create({
      data: {
        id: randomUUID(),
        organizationId: seed.orgId,
        locationId: seed.locationId,
        workOrderId: seed.workOrderId,
        assetId: seed.vanId,
      },
    });
    await expect(
      reservations.reserveLoaner({
        db: dbModule.db,
        context: seed.context(),
        assetId: seed.vanId,
        customerId: seed.customerId,
        locationId: seed.locationId,
        reservedFrom: new Date(base + 10 * DAY),
        reservedTo: new Date(base + 11 * DAY),
      }),
    ).rejects.toMatchObject({ reason: "asset_already_out" });

    // Foreign org reserves nothing; write permission is enforced.
    await expect(
      reservations.reserveLoaner({
        db: dbModule.db,
        context: {
          ...seed.context(),
          organizationId: seed.otherOrgId,
        } as import("@/modules/tenancy/policy").TenantContext,
        assetId: seed.truckId,
        customerId: seed.customerId,
        locationId: seed.locationId,
        reservedFrom: new Date(base),
        reservedTo: new Date(base + DAY),
      }),
    ).rejects.toMatchObject({ reason: "asset_not_found" });
    await expect(
      reservations.reserveLoaner({
        db: dbModule.db,
        context: seed.context(["work_orders.read"]),
        assetId: seed.truckId,
        customerId: seed.customerId,
        locationId: seed.locationId,
        reservedFrom: new Date(base),
        reservedTo: new Date(base + DAY),
      }),
    ).rejects.toThrowError(TenantAccessDenied);

    expect(await dbModule.db.loanerReservation.count()).toBe(0);
  });

  it("cancels reservations and converts them at check-out", async () => {
    const reservations = await import("@/modules/loaners/loaner-reservation-service");
    const loaners = await import("@/modules/loaners/loaner-service");
    const seed = await seedShop();

    const { reservationId } = await reservations.reserveLoaner({
      db: dbModule.db,
      context: seed.context(),
      assetId: seed.vanId,
      customerId: seed.customerId,
      locationId: seed.locationId,
      workOrderId: seed.workOrderId,
      reservedFrom: new Date(Date.now() - DAY),
      reservedTo: new Date(Date.now() + 2 * DAY),
    });

    // Checking the vehicle out converts the active reservation.
    await loaners.checkOutLoaner({
      db: dbModule.db,
      context: seed.context(),
      workOrderId: seed.workOrderId,
      assetId: seed.vanId,
      outMileage: 45_100,
    });
    expect(
      (await dbModule.db.loanerReservation.findUnique({ where: { id: reservationId } }))?.status,
    ).toBe("converted");

    // Cancel is only for still-reserved rows.
    await expect(
      reservations.cancelLoanerReservation({
        db: dbModule.db,
        context: seed.context(),
        reservationId,
      }),
    ).rejects.toMatchObject({ reason: "not_reserved" });

    // A fresh reservation cancels cleanly, freeing the window.
    const second = await reservations.reserveLoaner({
      db: dbModule.db,
      context: seed.context(),
      assetId: seed.truckId,
      customerId: seed.customerId,
      locationId: seed.locationId,
      reservedFrom: new Date(base + 10 * DAY),
      reservedTo: new Date(base + 12 * DAY),
    });
    await reservations.cancelLoanerReservation({
      db: dbModule.db,
      context: seed.context(),
      reservationId: second.reservationId,
    });
    // The window is free again.
    await expect(
      reservations.reserveLoaner({
        db: dbModule.db,
        context: seed.context(),
        assetId: seed.truckId,
        customerId: seed.customerId,
        locationId: seed.locationId,
        reservedFrom: new Date(base + 11 * DAY),
        reservedTo: new Date(base + 13 * DAY),
      }),
    ).resolves.toBeDefined();
  });
});
