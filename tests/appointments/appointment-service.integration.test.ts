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
  const otherOrgId = randomUUID();
  const locationId = randomUUID();
  const userId = randomUUID();
  const membershipId = randomUUID();
  const roleId = randomUUID();
  const customerId = randomUUID();
  const otherOrgCustomerId = randomUUID();

  await dbModule.db.$transaction([
    dbModule.db.organization.create({
      data: { id: orgId, slug: `org-${orgId.slice(0, 8)}`, name: "Appt Org" },
    }),
    dbModule.db.organization.create({
      data: { id: otherOrgId, slug: `org-${otherOrgId.slice(0, 8)}`, name: "Other Appt Org" },
    }),
    dbModule.db.location.create({
      data: {
        id: locationId,
        organizationId: orgId,
        code: "MAIN",
        name: "Main",
        timeZone: "America/New_York",
      },
    }),
    dbModule.db.user.create({
      data: { id: userId, email: `a-${userId.slice(0, 8)}@example.test`, displayName: "Appt User" },
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
        permissions: ["work_orders.read", "work_orders.write"],
      },
    }),
    dbModule.db.membershipRole.create({ data: { organizationId: orgId, membershipId, roleId } }),
    dbModule.db.customer.create({
      data: {
        id: customerId,
        organizationId: orgId,
        kind: "INDIVIDUAL",
        displayName: "Appt Customer",
      },
    }),
    dbModule.db.customer.create({
      data: {
        id: otherOrgCustomerId,
        organizationId: otherOrgId,
        kind: "INDIVIDUAL",
        displayName: "Other Org Customer",
      },
    }),
  ]);

  return {
    orgId,
    locationId,
    customerId,
    otherOrgCustomerId,
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

const tomorrow = (hour: number) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 1);
  date.setUTCHours(hour, 0, 0, 0);
  return date;
};

describe("appointments (#134)", { skip: shouldSkip }, () => {
  it("creates, transitions, and converts an appointment into a work order", async () => {
    const { createAppointment, transitionAppointment, convertAppointmentToWorkOrder } =
      await import("@/modules/appointments/appointment-service");
    const seedData = await seed();

    const { appointmentId } = await createAppointment({
      db: dbModule.db,
      context: seedData.context(),
      locationId: seedData.locationId,
      customerId: seedData.customerId,
      reason: "Oil change and tire rotation",
      startAt: tomorrow(14),
      endAt: tomorrow(15),
    });

    await transitionAppointment({
      db: dbModule.db,
      context: seedData.context(),
      appointmentId,
      targetStatus: "CONFIRMED",
    });
    await transitionAppointment({
      db: dbModule.db,
      context: seedData.context(),
      appointmentId,
      targetStatus: "CHECKED_IN",
    });

    const converted = await convertAppointmentToWorkOrder({
      db: dbModule.db,
      context: seedData.context(),
      appointmentId,
    });
    expect(converted.number).toMatch(/^RO-/);

    const appointment = await dbModule.db.appointment.findUnique({
      where: { id: appointmentId },
    });
    expect(appointment?.workOrderId).toBe(converted.workOrderId);

    const workOrder = await dbModule.db.workOrder.findUnique({
      where: { id: converted.workOrderId },
    });
    expect(workOrder?.customerConcern).toBe("Oil change and tire rotation");
    expect(workOrder?.customerId).toBe(seedData.customerId);

    await expect(
      convertAppointmentToWorkOrder({
        db: dbModule.db,
        context: seedData.context(),
        appointmentId,
      }),
    ).rejects.toMatchObject({ reason: "already_converted" });
  });

  it("enforces the lifecycle (no completion before check-in, no cancel after)", async () => {
    const { createAppointment, transitionAppointment } =
      await import("@/modules/appointments/appointment-service");
    const seedData = await seed();
    const { appointmentId } = await createAppointment({
      db: dbModule.db,
      context: seedData.context(),
      locationId: seedData.locationId,
      customerId: seedData.customerId,
      reason: "Brake inspection",
      startAt: tomorrow(16),
      endAt: tomorrow(17),
    });

    await expect(
      transitionAppointment({
        db: dbModule.db,
        context: seedData.context(),
        appointmentId,
        targetStatus: "COMPLETED",
      }),
    ).rejects.toMatchObject({ reason: "invalid_transition" });

    await transitionAppointment({
      db: dbModule.db,
      context: seedData.context(),
      appointmentId,
      targetStatus: "CHECKED_IN",
    });
    await expect(
      transitionAppointment({
        db: dbModule.db,
        context: seedData.context(),
        appointmentId,
        targetStatus: "CANCELLED",
      }),
    ).rejects.toMatchObject({ reason: "invalid_transition" });
  });

  it("rejects invalid time ranges and reschedules valid ones", async () => {
    const { createAppointment, rescheduleAppointment } =
      await import("@/modules/appointments/appointment-service");
    const seedData = await seed();

    await expect(
      createAppointment({
        db: dbModule.db,
        context: seedData.context(),
        locationId: seedData.locationId,
        customerId: seedData.customerId,
        reason: "Zero-length visit",
        startAt: tomorrow(10),
        endAt: tomorrow(10),
      }),
    ).rejects.toMatchObject({ reason: "invalid_time_range" });

    const { appointmentId } = await createAppointment({
      db: dbModule.db,
      context: seedData.context(),
      locationId: seedData.locationId,
      customerId: seedData.customerId,
      reason: "Reschedulable visit",
      startAt: tomorrow(10),
      endAt: tomorrow(11),
    });

    await rescheduleAppointment({
      db: dbModule.db,
      context: seedData.context(),
      appointmentId,
      startAt: tomorrow(13),
      endAt: tomorrow(14),
    });
    const appointment = await dbModule.db.appointment.findUnique({ where: { id: appointmentId } });
    expect(appointment?.startAt.toISOString()).toBe(tomorrow(13).toISOString());
  });

  it("lists appointments overlapping the day range, scoped to the organization", async () => {
    const { createAppointment, listAppointmentsInRange } =
      await import("@/modules/appointments/appointment-service");
    const seedA = await seed();
    const seedB = await seed();

    await createAppointment({
      db: dbModule.db,
      context: seedA.context(),
      locationId: seedA.locationId,
      customerId: seedA.customerId,
      reason: "In-range visit",
      startAt: tomorrow(9),
      endAt: tomorrow(10),
    });
    await createAppointment({
      db: dbModule.db,
      context: seedB.context(),
      locationId: seedB.locationId,
      customerId: seedB.customerId,
      reason: "Other org visit",
      startAt: tomorrow(9),
      endAt: tomorrow(10),
    });

    const dayStart = new Date(tomorrow(0));
    const dayEnd = new Date(tomorrow(0).getTime() + 24 * 60 * 60 * 1000);
    const listed = await listAppointmentsInRange({
      db: dbModule.db,
      context: seedA.context(),
      from: dayStart,
      to: dayEnd,
    });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.customerName).toBe("Appt Customer");
    expect(listed[0]?.reason).toBe("In-range visit");
  });

  it("denies cross-tenant customer references and cross-org appointments", async () => {
    const { createAppointment, transitionAppointment } =
      await import("@/modules/appointments/appointment-service");
    const seedA = await seed();
    const seedB = await seed();

    // A customer from another organization cannot be booked into org A.
    await expect(
      createAppointment({
        db: dbModule.db,
        context: seedA.context(),
        locationId: seedA.locationId,
        customerId: seedA.otherOrgCustomerId,
        reason: "Cross-tenant booking",
        startAt: tomorrow(9),
        endAt: tomorrow(10),
      }),
    ).rejects.toMatchObject({ reason: "customer_not_found" });

    // Org A's actor cannot act on org B's appointment.
    const { appointmentId } = await createAppointment({
      db: dbModule.db,
      context: seedB.context(),
      locationId: seedB.locationId,
      customerId: seedB.customerId,
      reason: "B org visit",
      startAt: tomorrow(9),
      endAt: tomorrow(10),
    });
    await expect(
      transitionAppointment({
        db: dbModule.db,
        context: seedA.context(),
        appointmentId,
        targetStatus: "CONFIRMED",
      }),
    ).rejects.toMatchObject({ reason: "appointment_not_found" });
  });
});
