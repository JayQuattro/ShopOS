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
  const secondLocationId = randomUUID();
  const userId = randomUUID();
  const membershipId = randomUUID();
  const roleId = randomUUID();
  const customerId = randomUUID();

  await dbModule.db.$transaction([
    dbModule.db.organization.create({
      data: { id: orgId, slug: `org-${orgId.slice(0, 8)}`, name: "Holiday Org" },
    }),
    dbModule.db.organization.create({
      data: { id: otherOrgId, slug: `o-${otherOrgId.slice(0, 8)}`, name: "Other Org" },
    }),
    dbModule.db.location.create({
      data: {
        id: locationId,
        organizationId: orgId,
        code: "A",
        name: "Main",
        timeZone: "America/New_York",
      },
    }),
    dbModule.db.location.create({
      data: {
        id: secondLocationId,
        organizationId: orgId,
        code: "B",
        name: "Branch",
        timeZone: "Europe/Rome",
      },
    }),
    dbModule.db.user.create({
      data: {
        id: userId,
        email: `ho-${userId.slice(0, 8)}@example.test`,
        displayName: "Holiday Admin",
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
          "organizations.manage",
          "work_orders.write",
          "work_orders.read",
          "customers.read",
        ],
      },
    }),
    dbModule.db.membershipRole.create({ data: { organizationId: orgId, membershipId, roleId } }),
    dbModule.db.customer.create({
      data: {
        id: customerId,
        organizationId: orgId,
        kind: "INDIVIDUAL",
        displayName: "Booking Customer",
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
      permissions: new Set<string>(
        permissions ?? ["organizations.manage", "work_orders.write", "work_orders.read"],
      ),
    }) as import("@/modules/tenancy/policy").TenantContext;

  return { orgId, otherOrgId, locationId, secondLocationId, customerId, context };
}

describe("holidays (#200)", { skip: shouldSkip }, () => {
  it("upserts one holiday per date, lists windows, and deletes", async () => {
    const holidays = await import("@/modules/organizations/holiday-service");
    const seed = await seedShop();

    await holidays.upsertHoliday({
      db: dbModule.db,
      context: seed.context(),
      locationId: seed.locationId,
      date: "2026-11-26",
      name: "Thanksgiving",
    });
    // Same date again updates rather than duplicating.
    await holidays.upsertHoliday({
      db: dbModule.db,
      context: seed.context(),
      locationId: seed.locationId,
      date: "2026-11-26",
      name: "Thanksgiving (revised)",
      closesAllDay: false,
    });
    await holidays.upsertHoliday({
      db: dbModule.db,
      context: seed.context(),
      locationId: seed.locationId,
      date: "2026-12-25",
      name: "Christmas",
    });

    const list = await holidays.listHolidays({
      db: dbModule.db,
      context: seed.context(),
      locationId: seed.locationId,
      from: "2026-01-01",
      to: "2026-12-31",
    });
    expect(list.map((h) => `${h.date}:${h.name}:${h.closesAllDay}`)).toEqual([
      "2026-11-26:Thanksgiving (revised):false",
      "2026-12-25:Christmas:true",
    ]);

    // All-day closure reflects the flag.
    expect(
      await holidays.allDayClosureOn(dbModule.db, seed.orgId, seed.locationId, "2026-12-25"),
    ).toEqual({
      name: "Christmas",
    });
    expect(
      await holidays.allDayClosureOn(dbModule.db, seed.orgId, seed.locationId, "2026-11-26"),
    ).toBeNull();

    await holidays.deleteHoliday({
      db: dbModule.db,
      context: seed.context(),
      holidayId: list[1]!.id,
    });
    expect(
      await holidays.allDayClosureOn(dbModule.db, seed.orgId, seed.locationId, "2026-12-25"),
    ).toBeNull();
  });

  it("keeps holidays per location and per organization", async () => {
    const holidays = await import("@/modules/organizations/holiday-service");
    const seed = await seedShop();

    await holidays.upsertHoliday({
      db: dbModule.db,
      context: seed.context(),
      locationId: seed.locationId,
      date: "2026-07-01",
      name: "Canada Day",
    });

    // Sibling location unaffected; foreign org sees nothing and cannot write.
    expect(
      await holidays.allDayClosureOn(dbModule.db, seed.orgId, seed.secondLocationId, "2026-07-01"),
    ).toBeNull();
    expect(
      await holidays.allDayClosureOn(dbModule.db, seed.otherOrgId, seed.locationId, "2026-07-01"),
    ).toBeNull();
    await expect(
      holidays.upsertHoliday({
        db: dbModule.db,
        context: {
          ...seed.context(),
          organizationId: seed.otherOrgId,
        } as import("@/modules/tenancy/policy").TenantContext,
        locationId: seed.locationId,
        date: "2026-07-01",
        name: "Sneaky",
      }),
    ).rejects.toMatchObject({ reason: "location_not_found" });
  });

  it("refuses all-day-closed bookings with the holiday reason and validates dates", async () => {
    const holidays = await import("@/modules/organizations/holiday-service");
    const appointments = await import("@/modules/appointments/appointment-service");
    const seed = await seedShop();

    await holidays.upsertHoliday({
      db: dbModule.db,
      context: seed.context(),
      locationId: seed.locationId,
      date: "2026-11-26",
      name: "Thanksgiving",
    });

    // A booking starting (in local time) on the holiday is refused.
    await expect(
      appointments.createAppointment({
        db: dbModule.db,
        context: seed.context(),
        locationId: seed.locationId,
        customerId: seed.customerId,
        reason: "Oil change",
        startAt: new Date("2026-11-26T15:00:00Z"), // 10:00 in America/New_York
        endAt: new Date("2026-11-26T16:00:00Z"),
      }),
    ).rejects.toMatchObject({ reason: "location_closed_holiday" });

    // A booking on a neighboring day is fine.
    const ok = await appointments.createAppointment({
      db: dbModule.db,
      context: seed.context(),
      locationId: seed.locationId,
      customerId: seed.customerId,
      reason: "Oil change",
      startAt: new Date("2026-11-27T15:00:00Z"),
      endAt: new Date("2026-11-27T16:00:00Z"),
    });
    expect(ok.appointmentId).toBeTruthy();

    // Bad dates are rejected up front.
    await expect(
      holidays.upsertHoliday({
        db: dbModule.db,
        context: seed.context(),
        locationId: seed.locationId,
        date: "not-a-date",
        name: "Nope",
      }),
    ).rejects.toMatchObject({ reason: "invalid_date" });
  });
});
