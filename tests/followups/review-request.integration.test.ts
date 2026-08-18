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

async function seedClosableWorkOrder(phone: string | null) {
  const orgId = randomUUID();
  const locationId = randomUUID();
  const userId = randomUUID();
  const membershipId = randomUUID();
  const roleId = randomUUID();
  const customerId = randomUUID();

  await dbModule.db.$transaction([
    dbModule.db.organization.create({
      data: { id: orgId, slug: `org-${orgId.slice(0, 8)}`, name: "Review Org" },
    }),
    dbModule.db.location.create({
      data: { id: locationId, organizationId: orgId, code: "MAIN", name: "Main", timeZone: "UTC" },
    }),
    dbModule.db.user.create({
      data: {
        id: userId,
        email: `r-${userId.slice(0, 8)}@example.test`,
        displayName: "Review User",
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
        permissions: ["work_orders.read", "work_orders.write"],
      },
    }),
    dbModule.db.membershipRole.create({ data: { organizationId: orgId, membershipId, roleId } }),
    dbModule.db.customer.create({
      data: {
        id: customerId,
        organizationId: orgId,
        kind: "INDIVIDUAL",
        displayName: "Review Customer",
        ...(phone ? { primaryPhone: phone } : {}),
      },
    }),
    dbModule.db.workOrder.create({
      data: {
        organizationId: orgId,
        locationId,
        customerId,
        number: "RO-1601",
        customerConcern: "Close me",
        status: "INVOICED",
      },
    }),
  ]);

  const workOrderId = (await dbModule.db.workOrder.findFirst({ where: { organizationId: orgId } }))!
    .id;

  return {
    orgId,
    workOrderId,
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

describe("review requests on close (#158)", { skip: shouldSkip }, () => {
  it("links the configured review page when set", async () => {
    const { transitionStatus } = await import("@/modules/work-orders/work-order-service");
    const { ReviewRequestHandler } = await import("@/modules/followups/review-request-handler");
    const { getConsoleSmsAdapter } = await import("@/modules/integrations/sms/sms-adapters");
    getConsoleSmsAdapter().sent.length = 0;
    const seedData = await seedClosableWorkOrder("+15550321");

    await dbModule.db.organization.update({
      where: { id: seedData.orgId },
      data: { reviewUrl: "https://g.page/example-shop/review" },
    });

    await transitionStatus({
      db: dbModule.db,
      context: seedData.context(),
      workOrderId: seedData.workOrderId,
      targetStatus: "CLOSED",
    });
    const event = await dbModule.db.outboxEvent.findFirst({
      where: { organizationId: seedData.orgId, eventType: "work_order.closed" },
    });
    await new ReviewRequestHandler(dbModule.db).handle({
      event: {
        id: event!.id,
        type: "work_order.closed",
        organizationId: seedData.orgId,
        aggregateType: "work_order",
        aggregateId: seedData.workOrderId,
        occurredAt: event!.occurredAt,
        data: (event!.payload ?? {}) as Record<string, unknown>,
      },
      tenant: { organizationId: seedData.orgId, requestId: "test", organizationStatus: "ACTIVE" },
    });

    expect(getConsoleSmsAdapter().sent).toHaveLength(1);
    expect(getConsoleSmsAdapter().sent[0]?.body).toContain("https://g.page/example-shop/review");
    expect(getConsoleSmsAdapter().sent[0]?.body).not.toContain("/track/");
  });

  it("enqueues a review event on the CLOSED transition and the handler texts the customer", async () => {
    const { transitionStatus } = await import("@/modules/work-orders/work-order-service");
    const { ReviewRequestHandler } = await import("@/modules/followups/review-request-handler");
    const { getConsoleSmsAdapter } = await import("@/modules/integrations/sms/sms-adapters");
    getConsoleSmsAdapter().sent.length = 0;
    const seedData = await seedClosableWorkOrder("+15550777");

    await transitionStatus({
      db: dbModule.db,
      context: seedData.context(),
      workOrderId: seedData.workOrderId,
      targetStatus: "CLOSED",
    });

    const event = await dbModule.db.outboxEvent.findFirst({
      where: { organizationId: seedData.orgId, eventType: "work_order.closed" },
    });
    expect(event).not.toBeNull();

    await new ReviewRequestHandler(dbModule.db).handle({
      event: {
        id: event!.id,
        type: "work_order.closed",
        organizationId: seedData.orgId,
        aggregateType: "work_order",
        aggregateId: seedData.workOrderId,
        occurredAt: event!.occurredAt,
        data: (event!.payload ?? {}) as Record<string, unknown>,
      },
      tenant: { organizationId: seedData.orgId, requestId: "test", organizationStatus: "ACTIVE" },
    });

    expect(getConsoleSmsAdapter().sent).toHaveLength(1);
    expect(getConsoleSmsAdapter().sent[0]?.body).toContain("Review Org");
    expect(getConsoleSmsAdapter().sent[0]?.body).toContain("review");

    const messages = await dbModule.db.smsMessage.findMany({
      where: { organizationId: seedData.orgId },
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]?.workOrderId).toBe(seedData.workOrderId);
  });

  it("completes silently when the customer has no phone", async () => {
    const { transitionStatus } = await import("@/modules/work-orders/work-order-service");
    const { ReviewRequestHandler } = await import("@/modules/followups/review-request-handler");
    const { getConsoleSmsAdapter } = await import("@/modules/integrations/sms/sms-adapters");
    getConsoleSmsAdapter().sent.length = 0;
    const seedData = await seedClosableWorkOrder(null);

    await transitionStatus({
      db: dbModule.db,
      context: seedData.context(),
      workOrderId: seedData.workOrderId,
      targetStatus: "CLOSED",
    });

    const event = await dbModule.db.outboxEvent.findFirst({
      where: { organizationId: seedData.orgId, eventType: "work_order.closed" },
    });
    expect(event).not.toBeNull();

    await new ReviewRequestHandler(dbModule.db).handle({
      event: {
        id: event!.id,
        type: "work_order.closed",
        organizationId: seedData.orgId,
        aggregateType: "work_order",
        aggregateId: seedData.workOrderId,
        occurredAt: event!.occurredAt,
        data: (event!.payload ?? {}) as Record<string, unknown>,
      },
      tenant: { organizationId: seedData.orgId, requestId: "test", organizationStatus: "ACTIVE" },
    });

    expect(getConsoleSmsAdapter().sent).toHaveLength(0);
  });
});
