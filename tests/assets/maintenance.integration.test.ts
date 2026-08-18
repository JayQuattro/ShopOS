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

async function seedWithAsset(phone: string | null) {
  const orgId = randomUUID();
  const locationId = randomUUID();
  const userId = randomUUID();
  const membershipId = randomUUID();
  const roleId = randomUUID();
  const customerId = randomUUID();
  const assetId = randomUUID();

  await dbModule.db.$transaction([
    dbModule.db.organization.create({
      data: { id: orgId, slug: `org-${orgId.slice(0, 8)}`, name: "PM Org" },
    }),
    dbModule.db.location.create({
      data: { id: locationId, organizationId: orgId, code: "MAIN", name: "Main", timeZone: "UTC" },
    }),
    dbModule.db.user.create({
      data: { id: userId, email: `p-${userId.slice(0, 8)}@example.test`, displayName: "PM User" },
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
        permissions: ["assets.read", "assets.write"],
      },
    }),
    dbModule.db.membershipRole.create({ data: { organizationId: orgId, membershipId, roleId } }),
    dbModule.db.customer.create({
      data: {
        id: customerId,
        organizationId: orgId,
        kind: "INDIVIDUAL",
        displayName: "PM Customer",
        ...(phone ? { primaryPhone: phone } : {}),
      },
    }),
    dbModule.db.asset.create({
      data: {
        id: assetId,
        organizationId: orgId,
        customerId,
        displayName: "PM Civic",
        category: "automobile",
      },
    }),
  ]);

  return {
    orgId,
    assetId,
    context: () =>
      ({
        actorId: userId,
        organizationId: orgId,
        membershipId,
        requestId: randomUUID(),
        organizationWideLocationAccess: true,
        allowedLocationIds: new Set<string>(),
        permissions: new Set(["assets.read", "assets.write"] as const),
      }) as import("@/modules/tenancy/policy").TenantContext,
  };
}

describe("preventive maintenance (#160)", { skip: shouldSkip }, () => {
  it("creates schedules, evaluates due states, and marks serviced", async () => {
    const { createSchedule, listSchedulesForAsset, markServiced } =
      await import("@/modules/assets/maintenance-service");
    const seedData = await seedWithAsset("+15550888");

    // Oil change due by time: last serviced 7 months ago, 6-month interval.
    const { scheduleId } = await createSchedule({
      db: dbModule.db,
      context: seedData.context(),
      assetId: seedData.assetId,
      name: "Oil change",
      intervalMiles: 5000,
      intervalMonths: 6,
      lastServicedAt: new Date(Date.now() - 7 * 30.44 * 24 * 60 * 60 * 1000),
      lastServicedMileage: 40000,
    });

    // Record current mileage past the interval.
    await dbModule.db.automotiveAssetProfile.create({
      data: { assetId: seedData.assetId, lastKnownMileage: 46500 },
    });

    let schedules = await listSchedulesForAsset({
      db: dbModule.db,
      context: seedData.context(),
      assetId: seedData.assetId,
    });
    expect(schedules).toHaveLength(1);
    expect(schedules[0]?.dueState).toBe("due");
    expect(schedules[0]?.mileage).toBe(46500);

    await markServiced({
      db: dbModule.db,
      context: seedData.context(),
      scheduleId,
      mileage: 46500,
    });

    schedules = await listSchedulesForAsset({
      db: dbModule.db,
      context: seedData.context(),
      assetId: seedData.assetId,
    });
    expect(schedules[0]?.dueState).toBe("ok");
    expect(schedules[0]?.lastServicedMileage).toBe(46500);
    // markServiced also refreshed the asset odometer.
    const profile = await dbModule.db.automotiveAssetProfile.findUnique({
      where: { assetId: seedData.assetId },
    });
    expect(profile?.lastKnownMileage).toBe(46500);
  });

  it("sweep finds due schedules with phones and not recently reminded; send stamps the reminder", async () => {
    const { createSchedule, findDueForReminders, sendPmReminder } =
      await import("@/modules/assets/maintenance-service");
    const { getConsoleSmsAdapter } = await import("@/modules/integrations/sms/sms-adapters");
    getConsoleSmsAdapter().sent.length = 0;

    const due = await seedWithAsset("+15550999");
    const notDue = await seedWithAsset("+15551000");
    const remindedRecently = await seedWithAsset("+15551111");

    await createSchedule({
      db: dbModule.db,
      context: due.context(),
      assetId: due.assetId,
      name: "Tire rotation",
      intervalMonths: 6,
      lastServicedAt: new Date(Date.now() - 8 * 30.44 * 24 * 60 * 60 * 1000),
    });
    await createSchedule({
      db: dbModule.db,
      context: notDue.context(),
      assetId: notDue.assetId,
      name: "Tire rotation",
      intervalMonths: 6,
      lastServicedAt: new Date(Date.now() - 1 * 30.44 * 24 * 60 * 60 * 1000),
    });
    const recent = await createSchedule({
      db: dbModule.db,
      context: remindedRecently.context(),
      assetId: remindedRecently.assetId,
      name: "Brake fluid",
      intervalMonths: 24,
      lastServicedAt: new Date(Date.now() - 30 * 30.44 * 24 * 60 * 60 * 1000),
    });
    await dbModule.db.maintenanceSchedule.update({
      where: { id: recent.scheduleId },
      data: { lastRemindedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000) },
    });

    const targets = await findDueForReminders(dbModule.db, new Date());
    expect(targets).toHaveLength(1);
    expect(targets[0]?.scheduleName).toBe("Tire rotation");
    expect(targets[0]?.customerPhone).toBe("+15550999");

    const sent = await sendPmReminder(dbModule.db, targets[0]!, "PM Org");
    expect(sent).toBe(true);
    expect(getConsoleSmsAdapter().sent).toHaveLength(1);
    expect(getConsoleSmsAdapter().sent[0]?.body).toContain("Tire rotation");
    expect(getConsoleSmsAdapter().sent[0]?.body).toContain("PM Civic");

    // The reminder stamp means the next sweep skips it.
    const again = await findDueForReminders(dbModule.db, new Date());
    expect(again).toHaveLength(0);
  });

  it("requires an interval and rejects duplicates per asset", async () => {
    const { createSchedule } = await import("@/modules/assets/maintenance-service");
    const seedData = await seedWithAsset(null);

    await expect(
      createSchedule({
        db: dbModule.db,
        context: seedData.context(),
        assetId: seedData.assetId,
        name: "No interval",
      }),
    ).rejects.toMatchObject({ reason: "invalid_interval" });

    await createSchedule({
      db: dbModule.db,
      context: seedData.context(),
      assetId: seedData.assetId,
      name: "Oil change",
      intervalMonths: 6,
    });
    await expect(
      createSchedule({
        db: dbModule.db,
        context: seedData.context(),
        assetId: seedData.assetId,
        name: "Oil change",
        intervalMonths: 6,
      }),
    ).rejects.toMatchObject({ reason: "duplicate_schedule" });
  });

  it("keeps schedules tenant-scoped", async () => {
    const { createSchedule, listSchedulesForAsset } =
      await import("@/modules/assets/maintenance-service");
    const seedA = await seedWithAsset(null);
    const seedB = await seedWithAsset(null);

    await expect(
      createSchedule({
        db: dbModule.db,
        context: seedA.context(),
        assetId: seedB.assetId,
        name: "Cross-org",
        intervalMonths: 6,
      }),
    ).rejects.toMatchObject({ reason: "asset_not_found" });

    await createSchedule({
      db: dbModule.db,
      context: seedB.context(),
      assetId: seedB.assetId,
      name: "Oil change",
      intervalMonths: 6,
    });
    const listA = await listSchedulesForAsset({
      db: dbModule.db,
      context: seedA.context(),
      assetId: seedA.assetId,
    });
    expect(listA).toHaveLength(0);
  });
});
