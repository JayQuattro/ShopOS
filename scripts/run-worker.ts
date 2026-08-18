import "dotenv/config";

import { db } from "../src/db/client";
import { AuthorizationRecordedEmailHandler } from "../src/modules/estimates/authorization-receipt-handler";
import { EstimatePresentedEmailHandler } from "../src/modules/estimates/estimate-email-handler";
import {
  InvoiceIssuedEmailHandler,
  PaymentRecordedEmailHandler,
} from "../src/modules/invoices/invoice-email-handlers";
import { ReviewRequestHandler } from "../src/modules/followups/review-request-handler";
import { EventHandlerRegistry } from "../src/modules/outbox/event-handler";
import { OutboxDispatcher } from "../src/modules/outbox/outbox-dispatcher";
import {
  findNoShows,
  findRemindersDue,
  sendAppointmentReminder,
} from "../src/modules/appointments/appointment-reminder-service";
import { findDueForReminders, sendPmReminder } from "../src/modules/assets/maintenance-service";

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
  handlers.register(new EstimatePresentedEmailHandler(db));
  handlers.register(new AuthorizationRecordedEmailHandler(db));
  handlers.register(new InvoiceIssuedEmailHandler(db));
  handlers.register(new PaymentRecordedEmailHandler(db));
  handlers.register(new ReviewRequestHandler(db));

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

  // Appointment reminder sweep: day-before reminders and no-show nudges,
  // once every 10 minutes. Failures never stop the dispatcher.
  const reminderTimer = setInterval(
    () => {
      void (async () => {
        const now = new Date();
        const [reminders, noShows] = await Promise.all([
          findRemindersDue(db, now),
          findNoShows(db, now),
        ]);
        for (const target of reminders) {
          const org = await db.organization.findUnique({
            where: { id: target.organizationId },
            select: { name: true },
          });
          await sendAppointmentReminder(db, target, "reminder", org?.name ?? "your shop");
        }
        for (const target of noShows) {
          const org = await db.organization.findUnique({
            where: { id: target.organizationId },
            select: { name: true },
          });
          await sendAppointmentReminder(db, target, "no_show", org?.name ?? "your shop");
        }
        // Preventive maintenance due reminders (30-day anti-spam per schedule).
        const pmTargets = await findDueForReminders(db, now);
        for (const target of pmTargets) {
          const org = await db.organization.findUnique({
            where: { id: target.organizationId },
            select: { name: true },
          });
          await sendPmReminder(db, target, org?.name ?? "your shop");
        }
      })().catch((error: unknown) => {
        console.error("[worker] reminder sweep failed", error);
      });
    },
    10 * 60 * 1000,
  );

  console.info(`[worker] outbox dispatcher started (poll=${pollIntervalMs}ms, batch=${batchSize})`);
  dispatcher.start();
  void reminderTimer;
}

main().catch((error: unknown) => {
  console.error("[worker] fatal startup error", error);
  process.exit(1);
});
