import type { DomainEvent } from "@/modules/activity/domain-event";

/**
 * The row shape returned by the outbox drain query. Mirrors the columns the
 * dispatcher claims with `FOR UPDATE SKIP LOCKED`.
 */
export type OutboxEventRow = Readonly<{
  id: string;
  organizationId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: unknown;
  occurredAt: Date;
  attempts: number;
}>;

/**
 * Maps a raw outbox row into the canonical {@link DomainEvent} shape consumed
 * by event handlers. The payload (JSON) is passed through as `data` without
 * validation — handlers are responsible for narrowing their own event data.
 *
 * `locationId` is not stored on the outbox row; handlers derive it from `data`
 * when relevant.
 */
export function mapOutboxEventToDomainEvent(row: OutboxEventRow): DomainEvent {
  return {
    id: row.id,
    type: row.eventType,
    organizationId: row.organizationId,
    aggregateType: row.aggregateType,
    aggregateId: row.aggregateId,
    occurredAt: row.occurredAt,
    data: (isPlainObject(row.payload) ? row.payload : {}) as Readonly<Record<string, unknown>>,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
