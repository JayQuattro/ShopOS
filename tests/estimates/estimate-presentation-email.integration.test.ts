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

async function seedWorkOrder(options: { contactEmail: string | null }) {
  const orgId = randomUUID();
  const locationId = randomUUID();
  const userId = randomUUID();
  const membershipId = randomUUID();
  const roleId = randomUUID();
  const customerId = randomUUID();

  await dbModule.db.$transaction([
    dbModule.db.organization.create({
      data: { id: orgId, slug: `org-${orgId.slice(0, 8)}`, name: "Notify Org" },
    }),
    dbModule.db.location.create({
      data: { id: locationId, organizationId: orgId, code: "MAIN", name: "Main", timeZone: "UTC" },
    }),
    dbModule.db.user.create({
      data: {
        id: userId,
        email: `u-${userId.slice(0, 8)}@example.test`,
        displayName: "Notify User",
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
        permissions: ["work_orders.read", "work_orders.write", "estimates.present"],
      },
    }),
    dbModule.db.membershipRole.create({ data: { organizationId: orgId, membershipId, roleId } }),
    dbModule.db.customer.create({
      data: {
        id: customerId,
        organizationId: orgId,
        kind: "INDIVIDUAL",
        displayName: "Notify Customer",
        primaryEmail: options.contactEmail,
      },
    }),
    ...(options.contactEmail
      ? [
          dbModule.db.customerContact.create({
            data: {
              id: randomUUID(),
              organizationId: orgId,
              customerId,
              name: "Notify Contact",
              email: options.contactEmail,
              isPrimary: true,
            },
          }),
        ]
      : []),
  ]);

  const wo = await dbModule.db.workOrder.create({
    data: {
      organizationId: orgId,
      locationId,
      customerId,
      number: "RO-3001",
      customerConcern: "Noise on braking",
    },
  });

  return {
    orgId,
    locationId,
    workOrderId: wo.id,
    context: () =>
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
          "estimates.present",
        ] as const),
      }) as import("@/modules/tenancy/policy").TenantContext,
  };
}

async function presentFirstRevision(seed: Awaited<ReturnType<typeof seedWorkOrder>>) {
  const { createDraftRevision, addLine, presentRevision } =
    await import("@/modules/estimates/estimate-service");
  const { revisionId } = await createDraftRevision({
    db: dbModule.db,
    context: seed.context(),
    workOrderId: seed.workOrderId,
    currency: "USD",
  });
  await addLine({
    db: dbModule.db,
    context: seed.context(),
    revisionId,
    kind: "LABOR",
    serviceGroupKey: "brakes",
    description: "Front brake pads",
    quantityMilli: 1000,
    unitPriceMinor: 15000,
    discountMinor: 0,
    taxable: false,
    taxRateBasisPoints: 0,
    position: 1,
  });
  await presentRevision({ db: dbModule.db, context: seed.context(), revisionId });
  return revisionId;
}

async function drainOnce() {
  const { OutboxDispatcher } = await import("@/modules/outbox/outbox-dispatcher");
  const { EventHandlerRegistry } = await import("@/modules/outbox/event-handler");
  const { EstimatePresentedEmailHandler } =
    await import("@/modules/estimates/estimate-email-handler");
  const handlers = new EventHandlerRegistry();
  handlers.register(new EstimatePresentedEmailHandler(dbModule.db));
  const dispatcher = new OutboxDispatcher({ db: dbModule.db, handlers });
  return dispatcher.drainOnce();
}

describe("estimate presentation notification", { skip: shouldSkip }, () => {
  it("issues an authorization link and enqueues an outbox event transactionally", async () => {
    const seed = await seedWorkOrder({ contactEmail: "customer@example.test" });
    const revisionId = await presentFirstRevision(seed);

    const link = await dbModule.db.authorizationLink.findFirst({
      where: { estimateRevisionId: revisionId, revokedAt: null, usedAt: null },
    });
    expect(link).not.toBeNull();
    expect(link?.token).toHaveLength(43); // 32 bytes base64url

    const event = await dbModule.db.outboxEvent.findFirst({
      where: { organizationId: seed.orgId, eventType: "estimate.presented" },
    });
    expect(event).not.toBeNull();
    expect(event?.publishedAt).toBeNull();
    expect((event?.payload as Record<string, unknown>).revisionId).toBe(revisionId);
  });

  it("revokes outstanding links from earlier revisions when a new one is presented", async () => {
    const { supersedeRevision, addLine, presentRevision } =
      await import("@/modules/estimates/estimate-service");
    const seed = await seedWorkOrder({ contactEmail: "customer@example.test" });
    const firstRevisionId = await presentFirstRevision(seed);

    const { newRevisionId } = await supersedeRevision({
      db: dbModule.db,
      context: seed.context(),
      revisionId: firstRevisionId,
    });
    await addLine({
      db: dbModule.db,
      context: seed.context(),
      revisionId: newRevisionId,
      kind: "PART",
      serviceGroupKey: "brakes",
      description: "Pads set",
      quantityMilli: 1000,
      unitPriceMinor: 8000,
      discountMinor: 0,
      taxable: false,
      taxRateBasisPoints: 0,
      position: 1,
    });
    await presentRevision({ db: dbModule.db, context: seed.context(), revisionId: newRevisionId });

    const oldLink = await dbModule.db.authorizationLink.findFirst({
      where: { estimateRevisionId: firstRevisionId },
    });
    expect(oldLink?.revokedAt).not.toBeNull();

    const newLink = await dbModule.db.authorizationLink.findFirst({
      where: { estimateRevisionId: newRevisionId, revokedAt: null },
    });
    expect(newLink).not.toBeNull();
  });

  it("delivers the authorization email when the outbox drains", async () => {
    const { getConsoleEmailSender } =
      await import("@/modules/integrations/email/transactional-email");
    getConsoleEmailSender().reset();

    const seed = await seedWorkOrder({ contactEmail: "customer@example.test" });
    await presentFirstRevision(seed);

    const summary = await drainOnce();
    expect(summary.dispatched).toBe(1);
    expect(summary.failed).toBe(0);

    const sent = getConsoleEmailSender().sentEmails();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("customer@example.test");
    expect(sent[0]?.organizationId).toBe(seed.orgId);
    expect(sent[0]?.subject).toContain("RO-3001");

    const activity = await dbModule.db.activityEvent.findFirst({
      where: { organizationId: seed.orgId, eventType: "estimate.email_sent" },
    });
    expect(activity?.summary).not.toMatch(/authorize\/\w/); // no token in the summary
  });

  it("marks the outbox row published after delivery", async () => {
    const seed = await seedWorkOrder({ contactEmail: "customer@example.test" });
    await presentFirstRevision(seed);
    await drainOnce();

    const event = await dbModule.db.outboxEvent.findFirst({
      where: { organizationId: seed.orgId, eventType: "estimate.presented" },
    });
    expect(event?.publishedAt).not.toBeNull();
  });

  it("skips email (without retry churn) when the customer has no contact email", async () => {
    const { getConsoleEmailSender } =
      await import("@/modules/integrations/email/transactional-email");
    getConsoleEmailSender().reset();

    const seed = await seedWorkOrder({ contactEmail: null });
    await presentFirstRevision(seed);

    const summary = await drainOnce();
    expect(summary.dispatched).toBe(1);
    expect(summary.failed).toBe(0);
    expect(getConsoleEmailSender().sentEmails()).toHaveLength(0);

    const activity = await dbModule.db.activityEvent.findFirst({
      where: { organizationId: seed.orgId, eventType: "estimate.email_skipped" },
    });
    expect(activity).not.toBeNull();
  });
});
