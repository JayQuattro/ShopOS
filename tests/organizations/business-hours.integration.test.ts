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

async function seedLocation(options?: {
  timeZone?: string;
  hours?: Array<{ weekday: number; openMinute: number; closeMinute: number }>;
  capacity?: number;
}) {
  const orgId = randomUUID();
  const locationId = randomUUID();
  const userId = randomUUID();
  const membershipId = randomUUID();
  const roleId = randomUUID();
  const customerId = randomUUID();

  await dbModule.db.$transaction([
    dbModule.db.organization.create({
      data: { id: orgId, slug: `org-${orgId.slice(0, 8)}`, name: "Hours Org" },
    }),
    dbModule.db.location.create({
      data: {
        id: locationId,
        organizationId: orgId,
        code: "MAIN",
        name: "Main",
        timeZone: options?.timeZone ?? "UTC",
        ...(options?.capacity ? { bookingCapacity: options.capacity } : {}),
      },
    }),
    dbModule.db.user.create({
      data: {
        id: userId,
        email: `h-${userId.slice(0, 8)}@example.test`,
        displayName: "Hours User",
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
        permissions: ["work_orders.read", "work_orders.write", "organizations.manage"],
      },
    }),
    dbModule.db.membershipRole.create({ data: { organizationId: orgId, membershipId, roleId } }),
    dbModule.db.customer.create({
      data: {
        id: customerId,
        organizationId: orgId,
        kind: "INDIVIDUAL",
        displayName: "Hours Customer",
      },
    }),
  ]);

  for (const window of options?.hours ?? []) {
    await dbModule.db.locationBusinessHour.create({
      data: {
        id: randomUUID(),
        organizationId: orgId,
        locationId,
        ...window,
      },
    });
  }

  const context = () =>
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
        "organizations.manage",
      ] as const),
    }) as import("@/modules/tenancy/policy").TenantContext;

  return { orgId, locationId, customerId, context };
}

const MON_TO_FRI_9_TO_5 = [1, 2, 3, 4, 5].map((weekday) => ({
  weekday,
  openMinute: 9 * 60,
  closeMinute: 17 * 60,
}));

describe("business hours and booking capacity (#170)", { skip: shouldSkip }, () => {
  it("saves and reads weekly hours and booking settings", async () => {
    const { getBusinessHours, replaceBusinessHours, updateBookingSettings } =
      await import("@/modules/organizations/business-hours-service");
    const seedData = await seedLocation();
    const context = seedData.context();

    await replaceBusinessHours(dbModule.db, context, seedData.locationId, MON_TO_FRI_9_TO_5);
    await updateBookingSettings(dbModule.db, context, seedData.locationId, {
      slotMinutes: 90,
      bookingCapacity: 3,
    });

    const config = await getBusinessHours(dbModule.db, context, seedData.locationId);
    expect(config.hours).toHaveLength(5);
    expect(config.hours[0]?.weekday).toBe(1);
    expect(config.hours[0]?.openMinute).toBe(540);
    expect(config.slotMinutes).toBe(90);
    expect(config.bookingCapacity).toBe(3);

    await expect(
      replaceBusinessHours(dbModule.db, context, seedData.locationId, [
        { weekday: 9, openMinute: 540, closeMinute: 1020 },
      ]),
    ).rejects.toMatchObject({ reason: "invalid_weekday" });
    await expect(
      replaceBusinessHours(dbModule.db, context, seedData.locationId, [
        { weekday: 1, openMinute: 1020, closeMinute: 540 },
      ]),
    ).rejects.toMatchObject({ reason: "invalid_window" });
  });

  it("refuses appointments outside hours and honors capacity", async () => {
    const { createAppointment } = await import("@/modules/appointments/appointment-service");
    const seedData = await seedLocation({ hours: MON_TO_FRI_9_TO_5, capacity: 1 });
    const context = seedData.context();

    const weekdayAt = (target: number, hour: number): Date => {
      for (let offset = 1; offset <= 7; offset += 1) {
        const date = new Date();
        date.setUTCDate(date.getUTCDate() + offset);
        date.setUTCHours(hour, 0, 0, 0);
        if (date.getUTCDay() === target) return date;
      }
      return new Date();
    };
    const mon10 = weekdayAt(1, 10);
    const mon11 = new Date(mon10.getTime() + 60 * 60_000);
    const sat10 = weekdayAt(6, 10);
    const sat11 = new Date(sat10.getTime() + 60 * 60_000);
    const mon8 = weekdayAt(1, 8);
    const mon9 = new Date(mon8.getTime() + 60 * 60_000);

    // Inside hours on a weekday: fine.
    await createAppointment({
      db: dbModule.db,
      context,
      locationId: seedData.locationId,
      customerId: seedData.customerId,
      reason: "Weekday visit",
      startAt: mon10,
      endAt: mon11,
    });

    // Saturday (closed): refused.
    await expect(
      createAppointment({
        db: dbModule.db,
        context,
        locationId: seedData.locationId,
        customerId: seedData.customerId,
        reason: "Weekend visit",
        startAt: sat10,
        endAt: sat11,
      }),
    ).rejects.toMatchObject({ reason: "outside_business_hours" });

    // Before opening on a weekday: refused.
    await expect(
      createAppointment({
        db: dbModule.db,
        context,
        locationId: seedData.locationId,
        customerId: seedData.customerId,
        reason: "Too early",
        startAt: mon8,
        endAt: mon9,
      }),
    ).rejects.toMatchObject({ reason: "outside_business_hours" });

    // Capacity 1: a second overlapping appointment in the same slot is refused.
    await expect(
      createAppointment({
        db: dbModule.db,
        context,
        locationId: seedData.locationId,
        customerId: seedData.customerId,
        reason: "Same time",
        startAt: mon10,
        endAt: mon11,
      }),
    ).rejects.toMatchObject({ reason: "slot_capacity_exceeded" });
  });

  it("unconfigured locations stay unrestricted (back-compat)", async () => {
    const { createAppointment } = await import("@/modules/appointments/appointment-service");
    const seedData = await seedLocation(); // no hours rows
    const context = seedData.context();

    // Sunday 8am would normally be closed; with no hours configured it's fine.
    const sunday = (() => {
      for (let offset = 1; offset <= 7; offset += 1) {
        const date = new Date();
        date.setUTCDate(date.getUTCDate() + offset);
        date.setUTCHours(8, 0, 0, 0);
        if (date.getUTCDay() === 0) return date;
      }
      return new Date();
    })();

    const created = await createAppointment({
      db: dbModule.db,
      context,
      locationId: seedData.locationId,
      customerId: seedData.customerId,
      reason: "Legacy shop, no hours set",
      startAt: sunday,
      endAt: new Date(sunday.getTime() + 60 * 60_000),
    });
    expect(created.appointmentId).toBeTruthy();
  });

  it("evaluates hours in the location's time zone", async () => {
    const { createAppointment } = await import("@/modules/appointments/appointment-service");
    // New York shop, 9–17 local = 13/14–21/22 UTC depending on DST.
    const seedData = await seedLocation({
      timeZone: "America/New_York",
      hours: MON_TO_FRI_9_TO_5,
    });
    const context = seedData.context();

    const findWeekday = (target: number): number => {
      for (let offset = 1; offset <= 7; offset += 1) {
        const date = new Date();
        date.setUTCDate(date.getUTCDate() + offset);
        date.setUTCHours(0, 0, 0, 0);
        if (date.getUTCDay() === target) return offset;
      }
      return 1;
    };
    const tuesday = findWeekday(2);

    // 15:00 UTC = 10/11am in New York: inside hours either way.
    const ok = new Date();
    ok.setUTCDate(ok.getUTCDate() + tuesday);
    ok.setUTCHours(15, 0, 0, 0);
    const created = await createAppointment({
      db: dbModule.db,
      context,
      locationId: seedData.locationId,
      customerId: seedData.customerId,
      reason: "TZ ok",
      startAt: ok,
      endAt: new Date(ok.getTime() + 60 * 60_000),
    });
    expect(created.appointmentId).toBeTruthy();

    // 02:00 UTC = ~9/10pm in New York: outside hours.
    const late = new Date();
    late.setUTCDate(late.getUTCDate() + tuesday);
    late.setUTCHours(2, 0, 0, 0);
    await expect(
      createAppointment({
        db: dbModule.db,
        context,
        locationId: seedData.locationId,
        customerId: seedData.customerId,
        reason: "TZ late",
        startAt: late,
        endAt: new Date(late.getTime() + 60 * 60_000),
      }),
    ).rejects.toMatchObject({ reason: "outside_business_hours" });
  });
});
