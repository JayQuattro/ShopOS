import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { assertDedicatedTestDatabase, resetTestDatabase } from "../helpers/database";

/**
 * Integration test for the outbox dispatcher against a throwaway PostgreSQL
 * database.
 *
 * Verifies: successful dispatch sets published_at, handler failure increments
 * attempts with backoff, poison messages are dead-lettered after maxAttempts,
 * suspended-org events are skipped, and the tenant context is revalidated.
 *
 * Requires SHOPOS_TEST_DATABASE_URL. Skips cleanly when Postgres is unreachable.
 */

const TEST_DATABASE_URL =
  process.env.SHOPOS_TEST_DATABASE_URL ?? "postgres://shopos:shopos@localhost:5432/shopos_test";
assertDedicatedTestDatabase(TEST_DATABASE_URL);

const env = process.env as Record<string, string | undefined>;
env.DATABASE_URL = TEST_DATABASE_URL;
env.BETTER_AUTH_URL = "http://localhost:3000";
env.BETTER_AUTH_SECRET = "integration-test-secret-at-least-32-characters-long";
env.NODE_ENV = "test";
env.AUTH_EMAIL_DELIVERY = "console";

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

/** Seeds an active organization so outbox events reference a valid tenant. */
async function seedOrganization(status: "ACTIVE" | "SUSPENDED" = "ACTIVE"): Promise<string> {
  const orgId = randomUUID();
  await dbModule.db.organization.create({
    data: {
      id: orgId,
      slug: `org-${orgId.slice(0, 8)}`,
      name: "Outbox Test Org",
      status,
    },
  });
  return orgId;
}

/** Inserts a raw outbox event for the given org. */
async function seedOutboxEvent(
  organizationId: string,
  overrides?: Partial<{
    eventType: string;
    payload: object;
    attempts: number;
    availableAt: Date;
  }>,
): Promise<string> {
  const id = randomUUID();
  await dbModule.db.outboxEvent.create({
    data: {
      id,
      organizationId,
      eventType: overrides?.eventType ?? "membership.created",
      aggregateType: "membership",
      aggregateId: randomUUID(),
      payload: overrides?.payload ?? { role: "advisor" },
      attempts: overrides?.attempts ?? 0,
      ...(overrides?.availableAt ? { availableAt: overrides.availableAt } : {}),
    },
  });
  return id;
}

describe("OutboxDispatcher", { skip: shouldSkip }, () => {
  it("dispatches an event and sets published_at on success", async () => {
    const { OutboxDispatcher } = await import("@/modules/outbox/outbox-dispatcher");
    const { EventHandlerRegistry } = await import("@/modules/outbox/event-handler");
    const orgId = await seedOrganization();
    const eventId = await seedOutboxEvent(orgId);

    const dispatcher = new OutboxDispatcher({
      db: dbModule.db,
      handlers: new EventHandlerRegistry(),
    });
    const summary = await dispatcher.drainOnce();

    expect(summary.dispatched).toBe(1);
    const row = await dbModule.db.outboxEvent.findUnique({ where: { id: eventId } });
    expect(row?.publishedAt).not.toBeNull();
  });

  it("increments attempts and sets backoff when a handler fails", async () => {
    const { OutboxDispatcher } = await import("@/modules/outbox/outbox-dispatcher");
    const { EventHandlerRegistry } = await import("@/modules/outbox/event-handler");
    type EventHandler = import("@/modules/outbox/event-handler").EventHandler;
    const orgId = await seedOrganization();
    const eventId = await seedOutboxEvent(orgId);

    const failingHandler: EventHandler = {
      eventType: "membership.created",
      async handle() {
        throw new Error("simulated handler failure");
      },
    };
    const registry = new EventHandlerRegistry();
    registry.register(failingHandler);

    const dispatcher = new OutboxDispatcher({ db: dbModule.db, handlers: registry });
    const summary = await dispatcher.drainOnce();

    expect(summary.failed).toBe(1);
    const row = await dbModule.db.outboxEvent.findUnique({ where: { id: eventId } });
    expect(row?.attempts).toBe(1);
    expect(row?.publishedAt).toBeNull();
    expect(row?.availableAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("dead-letters a poison message after maxAttempts", async () => {
    const { OutboxDispatcher } = await import("@/modules/outbox/outbox-dispatcher");
    const { EventHandlerRegistry } = await import("@/modules/outbox/event-handler");
    type EventHandler = import("@/modules/outbox/event-handler").EventHandler;
    const orgId = await seedOrganization();
    // Start at attempts = 4, so one more failure (→ 5) hits the limit.
    const eventId = await seedOutboxEvent(orgId, { attempts: 4 });

    const failingHandler: EventHandler = {
      eventType: "membership.created",
      async handle() {
        throw new Error("persistent failure");
      },
    };
    const registry = new EventHandlerRegistry();
    registry.register(failingHandler);

    const dispatcher = new OutboxDispatcher({
      db: dbModule.db,
      handlers: registry,
      maxAttempts: 5,
    });
    const summary = await dispatcher.drainOnce();

    expect(summary.deadLettered).toBe(1);
    const row = await dbModule.db.outboxEvent.findUnique({ where: { id: eventId } });
    expect(row?.publishedAt).not.toBeNull();
    expect(row?.attempts).toBe(5);
  });

  it("skips and dead-letters events for a suspended organization", async () => {
    const { OutboxDispatcher } = await import("@/modules/outbox/outbox-dispatcher");
    const { EventHandlerRegistry } = await import("@/modules/outbox/event-handler");
    const orgId = await seedOrganization("SUSPENDED");
    const eventId = await seedOutboxEvent(orgId);

    const dispatcher = new OutboxDispatcher({
      db: dbModule.db,
      handlers: new EventHandlerRegistry(),
    });
    const summary = await dispatcher.drainOnce();

    expect(summary.skipped).toBe(1);
    const row = await dbModule.db.outboxEvent.findUnique({ where: { id: eventId } });
    expect(row?.publishedAt).not.toBeNull();
  });

  it("does not double-dispatch when two drains run (SKIP LOCKED)", async () => {
    const { OutboxDispatcher } = await import("@/modules/outbox/outbox-dispatcher");
    const { EventHandlerRegistry } = await import("@/modules/outbox/event-handler");
    const orgId = await seedOrganization();
    await seedOutboxEvent(orgId);

    const dispatcher = new OutboxDispatcher({
      db: dbModule.db,
      handlers: new EventHandlerRegistry(),
    });

    // Run two drains concurrently — the second should claim nothing.
    const [first, second] = await Promise.all([dispatcher.drainOnce(), dispatcher.drainOnce()]);

    expect(first.dispatched + second.dispatched).toBe(1);
    expect(first.claimed + second.claimed).toBe(1);
  });

  it("leaves future-dated events unclaimed", async () => {
    const { OutboxDispatcher } = await import("@/modules/outbox/outbox-dispatcher");
    const { EventHandlerRegistry } = await import("@/modules/outbox/event-handler");
    const orgId = await seedOrganization();
    const future = new Date(Date.now() + 60_000);
    const eventId = await seedOutboxEvent(orgId, { availableAt: future });

    const dispatcher = new OutboxDispatcher({
      db: dbModule.db,
      handlers: new EventHandlerRegistry(),
    });
    const summary = await dispatcher.drainOnce();

    expect(summary.claimed).toBe(0);
    const row = await dbModule.db.outboxEvent.findUnique({ where: { id: eventId } });
    expect(row?.publishedAt).toBeNull();
  });
});
