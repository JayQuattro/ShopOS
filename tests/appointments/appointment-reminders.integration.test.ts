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

async function seedAppointment(options: {
  startAt: Date;
  status: "SCHEDULED" | "CONFIRMED" | "CHECKED_IN";
  phone: string | null;
}) {
  const orgId = randomUUID();
  const locationId = randomUUID();
  const customerId = randomUUID();

  await dbModule.db.$transaction([
    dbModule.db.organization.create({
      data: { id: orgId, slug: `org-${orgId.slice(0, 8)}`, name: "Remind Org" },
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
    dbModule.db.customer.create({
      data: {
        id: customerId,
        organizationId: orgId,
        kind: "INDIVIDUAL",
        displayName: "Remind Customer",
        ...(options.phone ? { primaryPhone: options.phone } : {}),
      },
    }),
    dbModule.db.appointment.create({
      data: {
        organizationId: orgId,
        locationId,
        customerId,
        status: options.status,
        reason: "Oil change",
        startAt: options.startAt,
        endAt: new Date(options.startAt.getTime() + 60 * 60 * 1000),
      },
    }),
  ]);

  return { orgId, customerId };
}

describe("appointment reminders (#155)", { skip: shouldSkip }, () => {
  it("finds appointments starting tomorrow with phones as reminders due", async () => {
    const { findRemindersDue } =
      await import("@/modules/appointments/appointment-reminder-service");
    const now = new Date();
    await seedAppointment({
      startAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      status: "CONFIRMED",
      phone: "+15550111",
    });
    await seedAppointment({
      startAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      status: "CONFIRMED",
      phone: null, // no phone — skipped
    });
    await seedAppointment({
      startAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      status: "CHECKED_IN", // already arrived — skipped
      phone: "+15550222",
    });
    await seedAppointment({
      startAt: new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000), // next week
      status: "SCHEDULED",
      phone: "+15550333",
    });

    const targets = await findRemindersDue(dbModule.db, now);
    expect(targets).toHaveLength(1);
    expect(targets[0]?.phone).toBe("+15550111");
    expect(targets[0]?.reason).toBe("Oil change");
  });

  it("finds appointments past their start still waiting as no-shows", async () => {
    const { findNoShows } = await import("@/modules/appointments/appointment-reminder-service");
    const now = new Date();
    await seedAppointment({
      startAt: new Date(now.getTime() - 4 * 60 * 60 * 1000),
      status: "SCHEDULED",
      phone: "+15550444",
    });
    await seedAppointment({
      startAt: new Date(now.getTime() - 4 * 60 * 60 * 1000),
      status: "CHECKED_IN", // arrived — not a no-show
      phone: "+15550555",
    });

    const targets = await findNoShows(dbModule.db, now);
    expect(targets).toHaveLength(1);
    expect(targets[0]?.phone).toBe("+15550444");
  });

  it("sends a reminder text and records it on the customer's thread", async () => {
    const { findRemindersDue, sendAppointmentReminder } =
      await import("@/modules/appointments/appointment-reminder-service");
    const { getConsoleSmsAdapter } = await import("@/modules/integrations/sms/sms-adapters");
    getConsoleSmsAdapter().sent.length = 0;
    const now = new Date();
    const seeded = await seedAppointment({
      startAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      status: "CONFIRMED",
      phone: "+15550666",
    });

    const targets = await findRemindersDue(dbModule.db, now);
    expect(targets).toHaveLength(1);
    const sent = await sendAppointmentReminder(dbModule.db, targets[0]!, "reminder", "Remind Org");
    expect(sent).toBe(true);
    expect(getConsoleSmsAdapter().sent).toHaveLength(1);
    expect(getConsoleSmsAdapter().sent[0]?.body).toContain("Remind Org");
    expect(getConsoleSmsAdapter().sent[0]?.body).toContain("tomorrow");

    const messages = await dbModule.db.smsMessage.findMany({
      where: { organizationId: seeded.orgId },
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]?.direction).toBe("outbound");
  });
});
