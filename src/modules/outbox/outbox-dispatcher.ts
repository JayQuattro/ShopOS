import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";

import { EventHandlerRegistry } from "./event-handler";
import type { JobTenantContext } from "./job-tenant-context";
import { revalidateJobTenantContext } from "./job-tenant-context";
import { JobTenantContextInvalid } from "./job-tenant-context";
import { mapOutboxEventToDomainEvent, type OutboxEventRow } from "./map-outbox-event";

export type OutboxDispatcherOptions = Readonly<{
  db: PrismaClient;
  handlers: EventHandlerRegistry;
  batchSize?: number;
  maxAttempts?: number;
  pollIntervalMs?: number;
  backoffBaseSeconds?: number;
  /** How long a claimed row is hidden from concurrent drains (the claim lease). */
  leaseMs?: number;
}>;

export type DrainSummary = Readonly<{
  claimed: number;
  dispatched: number;
  failed: number;
  deadLettered: number;
  skipped: number;
}>;

const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_POLL_INTERVAL_MS = 3_000;
const DEFAULT_BACKOFF_BASE_SECONDS = 30;
const DEFAULT_LEASE_MS = 60_000;

/**
 * Transactional-outbox dispatcher.
 *
 * Drains unpublished `outbox_events` rows using a `FOR UPDATE SKIP LOCKED`
 * query backed by the `outbox_unpublished_available_idx` partial index, so
 * multiple worker processes can drain concurrently without collision. Each
 * claimed row is mapped to a {@link DomainEvent}, its tenant context is
 * revalidated, and it is dispatched to the registered handler.
 *
 * On success the row's `published_at` is set. On failure `attempts` is
 * incremented and `available_at` is pushed forward by an exponential backoff so
 * the queue is not monopolized by a poison message. After `maxAttempts` the row
 * is dead-lettered (marked published so it stops blocking the queue).
 */
export class OutboxDispatcher {
  private readonly db: PrismaClient;
  private readonly handlers: EventHandlerRegistry;
  private readonly batchSize: number;
  private readonly maxAttempts: number;
  private readonly pollIntervalMs: number;
  private readonly backoffBaseSeconds: number;
  private readonly leaseMs: number;
  private interval: ReturnType<typeof setInterval> | undefined;
  private running = false;

  constructor(options: OutboxDispatcherOptions) {
    this.db = options.db;
    this.handlers = options.handlers;
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.backoffBaseSeconds = options.backoffBaseSeconds ?? DEFAULT_BACKOFF_BASE_SECONDS;
    this.leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
  }

  /**
   * Claims and dispatches a single batch. Safe to call concurrently.
   *
   * Claiming happens inside a short transaction: rows are selected with
   * `FOR UPDATE SKIP LOCKED` and immediately hidden from concurrent drains by
   * pushing `available_at` into the future (the "claim lease"). The handlers
   * then run outside the transaction (they may be slow), and each row is marked
   * published/retried/dead-lettered individually afterward.
   */
  async drainOnce(): Promise<DrainSummary> {
    const claimed = await this.claimAndHideBatch();

    if (claimed.length === 0) {
      return { claimed: 0, dispatched: 0, failed: 0, deadLettered: 0, skipped: 0 };
    }

    let dispatched = 0;
    let failed = 0;
    let deadLettered = 0;
    let skipped = 0;

    for (const row of claimed) {
      const result = await this.dispatchRow(row);
      switch (result) {
        case "dispatched":
          dispatched += 1;
          break;
        case "failed":
          failed += 1;
          break;
        case "dead_lettered":
          deadLettered += 1;
          break;
        case "skipped":
          skipped += 1;
          break;
      }
    }

    return { claimed: claimed.length, dispatched, failed, deadLettered, skipped };
  }

  /** Starts the polling loop. Call `stop()` for graceful shutdown. */
  start(): void {
    if (this.running) return;
    this.running = true;
    const tick = async () => {
      if (!this.running) return;
      try {
        await this.drainOnce();
      } catch (error) {
        this.logError("drain cycle failed", error);
      }
    };
    void tick();
    this.interval = setInterval(() => void tick(), this.pollIntervalMs);
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
    await this.db.$disconnect();
  }

  /**
   * Claims unpublished rows with row-level locking. Uses a reviewed raw query
   * because Prisma does not expose `FOR UPDATE SKIP LOCKED` in its query
   * builder (AGENTS.md permits raw SQL for PostgreSQL-specific hot paths).
   */
  /**
   * Claims unpublished rows inside a short transaction and immediately hides
   * them from concurrent drains by pushing `available_at` forward by a lease
   * window. This is the "claim" half of the transactional-outbox pattern: the
   * `FOR UPDATE SKIP LOCKED` prevents two workers from selecting the same row,
   * and the lease ensures that even if a worker crashes mid-dispatch, the row
   * becomes visible again after the lease expires rather than being lost.
   *
   * Uses a reviewed raw query because Prisma does not expose `FOR UPDATE SKIP
   * LOCKED` (AGENTS.md permits raw SQL for PostgreSQL-specific hot paths).
   */
  private async claimAndHideBatch(): Promise<OutboxEventRow[]> {
    return this.db.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<OutboxEventRow[]>`
        SELECT id,
               organization_id AS "organizationId",
               event_type AS "eventType",
               aggregate_type AS "aggregateType",
               aggregate_id AS "aggregateId",
               payload,
               occurred_at AS "occurredAt",
               attempts
        FROM outbox_events
        WHERE published_at IS NULL AND available_at <= now()
        ORDER BY available_at
        LIMIT ${this.batchSize}
        FOR UPDATE SKIP LOCKED
      `;

      if (rows.length === 0) {
        return [];
      }

      const claimedIds = rows.map((row) => row.id);
      // Push available_at forward by a lease so concurrent drains skip these
      // rows until this worker finishes or the lease expires.
      await transaction.outboxEvent.updateMany({
        where: { id: { in: claimedIds } },
        data: { availableAt: new Date(Date.now() + this.leaseMs) },
      });

      return rows;
    });
  }

  private async dispatchRow(
    row: OutboxEventRow,
  ): Promise<"dispatched" | "failed" | "dead_lettered" | "skipped"> {
    const requestId = `outbox:${row.id}:${randomUUID()}`;

    try {
      const tenant = await revalidateJobTenantContext({
        db: this.db,
        organizationId: row.organizationId,
        requestId,
      });

      const event = mapOutboxEventToDomainEvent(row);
      const handler = this.handlers.resolve(event.type);
      await handler.handle({ event, tenant });

      await this.markPublished(row.id);
      return "dispatched";
    } catch (error) {
      if (error instanceof JobTenantContextInvalid) {
        // The org is gone or suspended — don't retry a side effect that can't
        // run. Dead-letter immediately.
        await this.markDeadLettered(row.id, error.reason);
        return "skipped";
      }
      return this.handleFailure(row, error);
    }
  }

  private async handleFailure(
    row: OutboxEventRow,
    error: unknown,
  ): Promise<"failed" | "dead_lettered"> {
    this.logError(`handler failed for ${row.eventType} (${row.id})`, error);
    const nextAttempts = row.attempts + 1;

    if (nextAttempts >= this.maxAttempts) {
      await this.markDeadLettered(row.id, "max_attempts_exceeded");
      return "dead_lettered";
    }

    // Exponential backoff: base * 2^attempts.
    const backoffSeconds = this.backoffBaseSeconds * 2 ** row.attempts;
    await this.markRetry(row.id, nextAttempts, backoffSeconds);
    return "failed";
  }

  private async markPublished(id: string): Promise<void> {
    await this.db.outboxEvent.update({
      where: { id },
      data: { publishedAt: new Date() },
    });
  }

  private async markRetry(id: string, attempts: number, backoffSeconds: number): Promise<void> {
    await this.db.outboxEvent.update({
      where: { id },
      data: {
        attempts,
        availableAt: new Date(Date.now() + backoffSeconds * 1000),
      },
    });
  }

  /**
   * Marks an event as published (so it stops blocking the queue) while recording
   * that it was dead-lettered. The `published_at` timestamp + `attempts` at
   * maxAttempts + the injected `dispatchError` payload field are the dead-letter
   * signal until a dedicated dead-letter table is added.
   *
   * Uses a raw SQL `||` jsonb merge because Prisma does not expose a JSON-merge
   * helper, and this is a PostgreSQL-specific operation.
   */
  private async markDeadLettered(id: string, reason: string): Promise<void> {
    const safeReason = reason.replace(/'/g, "''");
    await this.db.$executeRaw`
      UPDATE outbox_events
      SET published_at = now(),
          attempts = ${this.maxAttempts},
          payload = payload || jsonb_build_object('dispatchError', ${safeReason}::text)
      WHERE id = ${id}::uuid
    `;
  }

  private logError(message: string, error: unknown): void {
    if (process.env.NODE_ENV !== "test") {
      console.error(`[outbox] ${message}`, error instanceof Error ? error.message : error);
    }
  }
}

export type { JobTenantContext };
