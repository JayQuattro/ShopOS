import "dotenv/config";

import { db } from "../src/db/client";
import { EventHandlerRegistry } from "../src/modules/outbox/event-handler";
import { OutboxDispatcher } from "../src/modules/outbox/outbox-dispatcher";

/**
 * Background worker entrypoint.
 *
 * Runs the transactional-outbox dispatcher as a separate process from the web
 * app, using the same codebase (docs/deployment-principles.md). Drains
 * `outbox_events`, revalidates tenant context for every job, and dispatches to
 * registered handlers. Today all event types resolve to the NoOp handler; real
 * side-effect handlers (notifications, search indexing, integrations) register
 * here as they are built.
 *
 * Run with: `pnpm worker`
 */
async function main(): Promise<void> {
  const pollIntervalMs = Number(process.env.OUTBOX_POLL_INTERVAL_MS ?? 3_000);
  const batchSize = Number(process.env.OUTBOX_BATCH_SIZE ?? 50);

  const handlers = new EventHandlerRegistry();
  // Register concrete handlers here as they are built. The NoOp fallback
  // handles any event type without a registered handler so the queue never
  // blocks on an unregistered event.

  const dispatcher = new OutboxDispatcher({
    db,
    handlers,
    pollIntervalMs: Number.isFinite(pollIntervalMs) ? pollIntervalMs : 3_000,
    batchSize: Number.isFinite(batchSize) ? batchSize : 50,
  });

  const shutdown = async (signal: string) => {
    console.info(`[worker] received ${signal}; shutting down gracefully…`);
    await dispatcher.stop();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  console.info(`[worker] outbox dispatcher started (poll=${pollIntervalMs}ms, batch=${batchSize})`);
  dispatcher.start();
}

main().catch((error: unknown) => {
  console.error("[worker] fatal startup error", error);
  process.exit(1);
});
