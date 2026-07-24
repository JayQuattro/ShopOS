import type { DomainEvent } from "@/modules/activity/domain-event";
import type { JobTenantContext } from "./job-tenant-context";

export type EventHandlerInput = Readonly<{
  event: DomainEvent;
  tenant: JobTenantContext;
}>;

export interface EventHandler {
  readonly eventType: string;
  handle(input: EventHandlerInput): Promise<void>;
}

/**
 * Registry mapping event types to their handlers. The dispatcher looks up a
 * handler by `event.type`; when none is registered, the {@link NoOpEventHandler}
 * is used so the queue never blocks on an unregistered event. Adding handlers
 * for new event types is a one-line registration.
 */
export class EventHandlerRegistry {
  private readonly handlers = new Map<string, EventHandler>();
  private readonly fallback = new NoOpEventHandler();

  register(handler: EventHandler): void {
    this.handlers.set(handler.eventType, handler);
  }

  resolve(eventType: string): EventHandler {
    return this.handlers.get(eventType) ?? this.fallback;
  }

  /** Returns the set of event types with a non-fallback handler registered. */
  registeredEventTypes(): ReadonlySet<string> {
    return new Set(this.handlers.keys());
  }
}

/**
 * Default handler for events with no registered consumer. Logs the event type
 * and organization (at debug level) and succeeds, allowing the dispatcher to
 * mark the outbox row as published. This proves the dispatch pipeline works for
 * every event type even before real side-effect handlers are wired.
 */
export class NoOpEventHandler implements EventHandler {
  readonly eventType = "__noop__";

  async handle(input: EventHandlerInput): Promise<void> {
    if (process.env.NODE_ENV !== "test") {
      console.debug(
        `[outbox] dispatched ${input.event.type} for org ${input.event.organizationId} (no handler registered)`,
      );
    }
  }
}
