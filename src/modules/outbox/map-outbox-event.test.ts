import { describe, expect, it } from "vitest";

import type { OutboxEventRow } from "@/modules/outbox/map-outbox-event";
import { mapOutboxEventToDomainEvent } from "@/modules/outbox/map-outbox-event";

const row: OutboxEventRow = {
  id: "evt-1",
  organizationId: "org-1",
  eventType: "membership.created",
  aggregateType: "membership",
  aggregateId: "membership-1",
  payload: { userId: "user-1", role: "advisor" },
  occurredAt: new Date("2026-07-24T00:00:00Z"),
  attempts: 0,
};

describe("mapOutboxEventToDomainEvent", () => {
  it("maps the row columns to the canonical domain-event fields", () => {
    const event = mapOutboxEventToDomainEvent(row);
    expect(event).toEqual({
      id: "evt-1",
      type: "membership.created",
      organizationId: "org-1",
      aggregateType: "membership",
      aggregateId: "membership-1",
      occurredAt: row.occurredAt,
      data: { userId: "user-1", role: "advisor" },
    });
  });

  it("defaults data to an empty object when the payload is not a plain object", () => {
    expect(mapOutboxEventToDomainEvent({ ...row, payload: null }).data).toEqual({});
    expect(mapOutboxEventToDomainEvent({ ...row, payload: "not-object" }).data).toEqual({});
    expect(mapOutboxEventToDomainEvent({ ...row, payload: [1, 2] }).data).toEqual({});
  });

  it("preserves an empty-object payload (e.g. membership.deactivated)", () => {
    expect(mapOutboxEventToDomainEvent({ ...row, payload: {} }).data).toEqual({});
  });
});
