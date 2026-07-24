import type { AuthDeliveryMessage, AuthDeliveryProvider } from "./auth-delivery-provider";

const CAPTURE_LIMIT = 64;

export type CapturedAuthDeliveryMessage = Readonly<{
  kind: AuthDeliveryMessage["kind"];
  to: string;
  recordedAt: string;
}>;

export type FullAuthDeliveryMessage = Readonly<{
  kind: AuthDeliveryMessage["kind"];
  to: string;
  recordedAt: string;
  /**
   * The full message, including any URL, token, or OTP. Only populated when the
   * adapter is constructed with `retainFullMessages: true`, which is intended
   * exclusively for controlled test environments where the throwaway delivery
   * target is the test harness itself. Production logging never reads this.
   */
  message: AuthDeliveryMessage;
}>;

type ConsoleAuthDeliveryProviderOptions = {
  /**
   * When true, the adapter retains full messages (URLs, tokens, OTPs) so
   * integration tests can extract verification tokens. Defaults to true when
   * NODE_ENV is "test" and false otherwise. Logged summaries are always
   * redacted regardless of this flag.
   */
  retainFullMessages?: boolean;
};

/**
 * Deterministic dev/test adapter.
 *
 * In tests it captures a redacted record (kind + recipient + timestamp) so flows
 * can assert a message was sent without touching a real inbox. In development it
 * logs the same redacted summary. It never logs tokens, reset URLs, OTPs, or
 * message bodies.
 *
 * In a controlled test environment it additionally retains the full message so
 * the harness can extract a verification token from the delivery callback. This
 * full capture is process-local and never logged.
 */
export class ConsoleAuthDeliveryProvider implements AuthDeliveryProvider {
  readonly key = "console";
  private readonly captured: CapturedAuthDeliveryMessage[] = [];
  private readonly full: FullAuthDeliveryMessage[] = [];
  private readonly retainFullMessages: boolean;

  constructor(options: ConsoleAuthDeliveryProviderOptions = {}) {
    this.retainFullMessages = options.retainFullMessages ?? process.env.NODE_ENV === "test";
  }

  send(message: AuthDeliveryMessage): void {
    const recordedAt = new Date().toISOString();
    this.captured.push({ kind: message.kind, to: message.to, recordedAt });
    if (this.captured.length > CAPTURE_LIMIT) {
      this.captured.shift();
    }

    if (this.retainFullMessages) {
      this.full.push({ kind: message.kind, to: message.to, recordedAt, message });
      if (this.full.length > CAPTURE_LIMIT) {
        this.full.shift();
      }
    }

    if (process.env.NODE_ENV !== "test") {
      console.info(`[auth-delivery] ${message.kind} -> ${message.to}`);
    }
  }

  /**
   * Returns a defensive copy of redacted captured messages. Used by integration
   * tests to assert that verification/reset/OTP messages were produced.
   */
  capturedMessages(): ReadonlyArray<CapturedAuthDeliveryMessage> {
    return [...this.captured];
  }

  /**
   * Returns the most recent full message of the given kind, including its URL or
   * OTP. Intended only for controlled test environments; returns undefined when
   * full-message retention is disabled or no message of the kind was captured.
   */
  latestFullMessage(kind: AuthDeliveryMessage["kind"]): FullAuthDeliveryMessage | undefined {
    for (let index = this.full.length - 1; index >= 0; index -= 1) {
      const entry = this.full[index];
      if (entry?.kind === kind) {
        return entry;
      }
    }
    return undefined;
  }

  reset(): void {
    this.captured.length = 0;
    this.full.length = 0;
  }
}

let singleton: ConsoleAuthDeliveryProvider | undefined;

/**
 * Returns a process-wide console delivery provider so the Better Auth callbacks
 * and the test harness observe the same capture buffer.
 */
export function getConsoleAuthDeliveryProvider(): ConsoleAuthDeliveryProvider {
  if (!singleton) {
    singleton = new ConsoleAuthDeliveryProvider();
  }
  return singleton;
}
