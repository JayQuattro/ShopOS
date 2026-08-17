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

async function seed() {
  const orgId = randomUUID();
  const locationId = randomUUID();
  const userId = randomUUID();
  const techId = randomUUID();
  const membershipId = randomUUID();
  const techMembershipId = randomUUID();
  const roleId = randomUUID();
  const customerId = randomUUID();

  await dbModule.db.$transaction([
    dbModule.db.organization.create({
      data: { id: orgId, slug: `org-${orgId.slice(0, 8)}`, name: "Time Org" },
    }),
    dbModule.db.location.create({
      data: { id: locationId, organizationId: orgId, code: "MAIN", name: "Main", timeZone: "UTC" },
    }),
    dbModule.db.user.create({
      data: {
        id: userId,
        email: `m-${userId.slice(0, 8)}@example.test`,
        displayName: "Time Manager",
      },
    }),
    dbModule.db.user.create({
      data: {
        id: techId,
        email: `t-${techId.slice(0, 8)}@example.test`,
        displayName: "Timer Tech",
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
    dbModule.db.organizationMembership.create({
      data: {
        id: techMembershipId,
        organizationId: orgId,
        userId: techId,
        organizationWideLocationAccess: true,
      },
    }),
    dbModule.db.role.create({
      data: {
        id: roleId,
        organizationId: orgId,
        key: "owner",
        name: "Owner",
        permissions: ["work_orders.read", "work_orders.write"],
      },
    }),
    dbModule.db.membershipRole.create({ data: { organizationId: orgId, membershipId, roleId } }),
    dbModule.db.membershipRole.create({
      data: { organizationId: orgId, membershipId: techMembershipId, roleId },
    }),
    dbModule.db.customer.create({
      data: {
        id: customerId,
        organizationId: orgId,
        kind: "INDIVIDUAL",
        displayName: "Time Customer",
      },
    }),
  ]);

  const makeWorkOrder = async (number: string) =>
    dbModule.db.workOrder.create({
      data: { organizationId: orgId, locationId, customerId, number, customerConcern: "Clock me" },
    });

  return {
    orgId,
    techId,
    workOrderA: (await makeWorkOrder("RO-9001")).id,
    workOrderB: (await makeWorkOrder("RO-9002")).id,
    context: () =>
      ({
        actorId: userId,
        organizationId: orgId,
        membershipId,
        requestId: randomUUID(),
        organizationWideLocationAccess: true,
        allowedLocationIds: new Set<string>(),
        permissions: new Set(["work_orders.read", "work_orders.write"] as const),
      }) as import("@/modules/tenancy/policy").TenantContext,
  };
}

describe("time entries (#135)", { skip: shouldSkip }, () => {
  it("starts and stops a timer, recording duration and activity", async () => {
    const { startTimer, stopTimer, listTimeEntries } =
      await import("@/modules/time-tracking/time-entry-service");
    const seedData = await seed();

    const { entryId } = await startTimer({
      db: dbModule.db,
      context: seedData.context(),
      workOrderId: seedData.workOrderA,
    });

    let entries = await listTimeEntries({
      db: dbModule.db,
      context: seedData.context(),
      workOrderId: seedData.workOrderA,
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.endedAt).toBeNull();

    // Backdate the start so the stopped duration is deterministic.
    await dbModule.db.timeEntry.update({
      where: { id: entryId },
      data: { startedAt: new Date(Date.now() - 90 * 60_000) },
    });

    const stopped = await stopTimer({
      db: dbModule.db,
      context: seedData.context(),
      workOrderId: seedData.workOrderA,
    });
    expect(stopped.entryId).toBe(entryId);
    expect(stopped.minutes).toBeGreaterThanOrEqual(89);
    expect(stopped.minutes).toBeLessThanOrEqual(91);

    entries = await listTimeEntries({
      db: dbModule.db,
      context: seedData.context(),
      workOrderId: seedData.workOrderA,
    });
    expect(entries[0]?.minutes).toBe(stopped.minutes);

    const activity = await dbModule.db.activityEvent.findFirst({
      where: { workOrderId: seedData.workOrderA, eventType: "time.stopped" },
    });
    expect(activity?.summary).toMatch(/1h \d+m/);
  });

  it("enforces one running timer per user across work orders", async () => {
    const { startTimer, stopTimer } = await import("@/modules/time-tracking/time-entry-service");
    const seedData = await seed();

    await startTimer({
      db: dbModule.db,
      context: seedData.context(),
      workOrderId: seedData.workOrderA,
    });
    await expect(
      startTimer({
        db: dbModule.db,
        context: seedData.context(),
        workOrderId: seedData.workOrderB,
      }),
    ).rejects.toMatchObject({ reason: "timer_already_running" });

    // Stopping via work order B's scope fails: the timer runs on A.
    await expect(
      stopTimer({
        db: dbModule.db,
        context: seedData.context(),
        workOrderId: seedData.workOrderB,
      }),
    ).rejects.toMatchObject({ reason: "no_running_timer" });

    await stopTimer({
      db: dbModule.db,
      context: seedData.context(),
      workOrderId: seedData.workOrderA,
    });

    // After stopping, a new timer may start elsewhere.
    const restarted = await startTimer({
      db: dbModule.db,
      context: seedData.context(),
      workOrderId: seedData.workOrderB,
    });
    expect(restarted.entryId).toBeTruthy();
  });

  it("rejects a second concurrent running timer at the database level", async () => {
    const seedData = await seed();
    // Insert a running row directly, bypassing the service guard, to prove
    // the partial unique index holds under races.
    const workOrder = await dbModule.db.workOrder.findFirst({
      where: { id: seedData.workOrderA },
      select: { locationId: true },
    });
    await dbModule.db.timeEntry.create({
      data: {
        organizationId: seedData.orgId,
        locationId: workOrder!.locationId,
        workOrderId: seedData.workOrderA,
        userId: seedData.context().actorId,
        startedAt: new Date(),
      },
    });
    await expect(
      dbModule.db.timeEntry.create({
        data: {
          organizationId: seedData.orgId,
          locationId: workOrder!.locationId,
          workOrderId: seedData.workOrderB,
          userId: seedData.context().actorId,
          startedAt: new Date(),
        },
      }),
    ).rejects.toThrow();
  });

  it("records manual entries for members and rejects invalid ranges", async () => {
    const { addManualEntry, listTimeEntries } =
      await import("@/modules/time-tracking/time-entry-service");
    const seedData = await seed();

    await expect(
      addManualEntry({
        db: dbModule.db,
        context: seedData.context(),
        workOrderId: seedData.workOrderA,
        userId: seedData.techId,
        startedAt: new Date(Date.now() + 3_600_000),
        endedAt: new Date(),
      }),
    ).rejects.toMatchObject({ reason: "invalid_time_range" });

    await addManualEntry({
      db: dbModule.db,
      context: seedData.context(),
      workOrderId: seedData.workOrderA,
      userId: seedData.techId,
      startedAt: new Date(Date.now() - 7_200_000),
      endedAt: new Date(Date.now() - 3_600_000),
      note: "Forgot to clock in",
    });

    const entries = await listTimeEntries({
      db: dbModule.db,
      context: seedData.context(),
      workOrderId: seedData.workOrderA,
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.userDisplayName).toBe("Timer Tech");
    expect(entries[0]?.minutes).toBe(60);
    expect(entries[0]?.note).toBe("Forgot to clock in");
  });

  it("keeps entries tenant-scoped and rejects cross-org work orders", async () => {
    const { addManualEntry, deleteTimeEntry, listTimeEntries } =
      await import("@/modules/time-tracking/time-entry-service");
    const seedA = await seed();
    const seedB = await seed();

    await expect(
      addManualEntry({
        db: dbModule.db,
        context: seedA.context(),
        workOrderId: seedB.workOrderA,
        userId: seedA.techId,
        startedAt: new Date(Date.now() - 3_600_000),
        endedAt: new Date(),
      }),
    ).rejects.toMatchObject({ reason: "work_order_not_found" });

    const { entryId } = await addManualEntry({
      db: dbModule.db,
      context: seedB.context(),
      workOrderId: seedB.workOrderA,
      userId: seedB.techId,
      startedAt: new Date(Date.now() - 3_600_000),
      endedAt: new Date(),
    });

    // Org A cannot list org B's work order's entries (no existence leak).
    await expect(
      listTimeEntries({
        db: dbModule.db,
        context: seedA.context(),
        workOrderId: seedB.workOrderA,
      }),
    ).rejects.toMatchObject({ reason: "work_order_not_found" });
    await expect(
      deleteTimeEntry({ db: dbModule.db, context: seedA.context(), entryId }),
    ).rejects.toMatchObject({ reason: "entry_not_found" });

    await deleteTimeEntry({ db: dbModule.db, context: seedB.context(), entryId });
  });
});
