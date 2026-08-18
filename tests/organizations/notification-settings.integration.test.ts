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

async function seedOrg(options?: { notifyAppointmentReminders?: boolean; leadHours?: number }) {
  const orgId = randomUUID();
  const userId = randomUUID();
  const membershipId = randomUUID();
  const roleId = randomUUID();
  const locationId = randomUUID();
  const customerId = randomUUID();

  await dbModule.db.$transaction([
    dbModule.db.organization.create({
      data: {
        id: orgId,
        slug: `org-${orgId.slice(0, 8)}`,
        name: "Notify Settings Org",
        ...(options?.notifyAppointmentReminders === false
          ? { notifyAppointmentReminders: false }
          : {}),
        ...(options?.leadHours ? { appointmentReminderLeadHours: options.leadHours } : {}),
      },
    }),
    dbModule.db.location.create({
      data: { id: locationId, organizationId: orgId, code: "MAIN", name: "Main", timeZone: "UTC" },
    }),
    dbModule.db.user.create({
      data: {
        id: userId,
        email: `n-${userId.slice(0, 8)}@example.test`,
        displayName: "Notify Settings User",
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
        permissions: ["organizations.manage", "work_orders.read", "work_orders.write"],
      },
    }),
    dbModule.db.membershipRole.create({ data: { organizationId: orgId, membershipId, roleId } }),
    dbModule.db.customer.create({
      data: {
        id: customerId,
        organizationId: orgId,
        kind: "INDIVIDUAL",
        displayName: "Notify Customer",
        primaryPhone: "+15550123",
      },
    }),
  ]);

  return {
    orgId,
    locationId,
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
          "organizations.manage",
          "work_orders.read",
          "work_orders.write",
        ] as const),
      }) as import("@/modules/tenancy/policy").TenantContext,
  };
}

async function addAppointment(
  orgId: string,
  locationId: string,
  customerId: string,
  startAt: Date,
) {
  await dbModule.db.appointment.create({
    data: {
      organizationId: orgId,
      locationId,
      customerId,
      status: "CONFIRMED",
      reason: "Oil change",
      startAt,
      endAt: new Date(startAt.getTime() + 60 * 60 * 1000),
    },
  });
}

describe("notification settings (#164)", { skip: shouldSkip }, () => {
  it("round-trips toggles and cadence with audit", async () => {
    const { getNotificationSettings, updateNotificationSettings } =
      await import("@/modules/organizations/notification-settings-service");
    const seedData = await seedOrg();

    await updateNotificationSettings(dbModule.db, seedData.context(), {
      notifyEstimateEmail: true,
      notifyDecisionReceiptEmail: false,
      notifyInvoiceEmail: true,
      notifyPaymentReceiptEmail: true,
      notifyAppointmentReminders: false,
      notifyPmReminders: true,
      notifyReviewRequests: false,
      appointmentReminderLeadHours: 12,
      noShowCutoffHours: 4,
      pmReminderCooldownDays: 60,
    });

    const settings = await getNotificationSettings(dbModule.db, seedData.context());
    expect(settings.notifyDecisionReceiptEmail).toBe(false);
    expect(settings.notifyAppointmentReminders).toBe(false);
    expect(settings.appointmentReminderLeadHours).toBe(12);
    expect(settings.pmReminderCooldownDays).toBe(60);

    const audit = await dbModule.db.auditEvent.findFirst({
      where: { action: "organization.notification_settings_updated" },
    });
    expect(audit?.after).toMatchObject({ appointmentReminderLeadHours: 12 });

    await expect(
      updateNotificationSettings(dbModule.db, seedData.context(), {
        ...settings,
        appointmentReminderLeadHours: 999,
      }),
    ).rejects.toMatchObject({ reason: "invalid_lead_hours" });
  });

  it("a disabled toggle removes the org's appointments from the reminder sweep", async () => {
    const { findRemindersDue } =
      await import("@/modules/appointments/appointment-reminder-service");
    const on = await seedOrg();
    const off = await seedOrg({ notifyAppointmentReminders: false });
    const now = new Date();

    await addAppointment(
      on.orgId,
      on.locationId,
      on.customerId,
      new Date(now.getTime() + 24 * 3_600_000),
    );
    await addAppointment(
      off.orgId,
      off.locationId,
      off.customerId,
      new Date(now.getTime() + 24 * 3_600_000),
    );

    const targets = await findRemindersDue(dbModule.db, now);
    expect(targets).toHaveLength(1);
    expect(targets[0]?.organizationId).toBe(on.orgId);
  });

  it("a custom lead hours setting moves the reminder window", async () => {
    const { findRemindersDue } =
      await import("@/modules/appointments/appointment-reminder-service");
    const soon = await seedOrg({ leadHours: 12 });
    const now = new Date();

    // 12h out: inside the 12h±6h window of the configured org.
    await addAppointment(
      soon.orgId,
      soon.locationId,
      soon.customerId,
      new Date(now.getTime() + 12 * 3_600_000),
    );
    const targets = await findRemindersDue(dbModule.db, now);
    expect(targets).toHaveLength(1);
    expect(targets[0]?.organizationId).toBe(soon.orgId);

    // 30h out: outside the 12h window.
    await dbModule.db.appointment.deleteMany({ where: { organizationId: soon.orgId } });
    await addAppointment(
      soon.orgId,
      soon.locationId,
      soon.customerId,
      new Date(now.getTime() + 30 * 3_600_000),
    );
    const none = await findRemindersDue(dbModule.db, now);
    expect(none).toHaveLength(0);
  });
});
