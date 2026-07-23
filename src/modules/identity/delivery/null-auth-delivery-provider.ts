import type { AuthDeliveryMessage, AuthDeliveryProvider } from "./auth-delivery-provider";

/**
 * Safe no-op adapter and the production default when no real delivery provider
 * is configured.
 *
 * It records a per-kind count and returns immediately. Only the message kind is
 * retained — never the recipient, URL, OTP, or body — so a misconfigured
 * production deployment fails closed without leaking state or revealing whether
 * an address exists. A real provider (SMTP/Resend/etc.) will replace this behind
 * the same interface.
 */
export class NullAuthDeliveryProvider implements AuthDeliveryProvider {
  readonly key = "none";
  private readonly counts = new Map<AuthDeliveryMessage["kind"], number>();

  send(message: AuthDeliveryMessage): void {
    const next = (this.counts.get(message.kind) ?? 0) + 1;
    this.counts.set(message.kind, next);
  }

  sentMessages(): number {
    return [...this.counts.values()].reduce((total, count) => total + count, 0);
  }

  sentByKind(): ReadonlyMap<AuthDeliveryMessage["kind"], number> {
    return new Map(this.counts);
  }
}

let singleton: NullAuthDeliveryProvider | undefined;

export function getNullAuthDeliveryProvider(): NullAuthDeliveryProvider {
  if (!singleton) {
    singleton = new NullAuthDeliveryProvider();
  }
  return singleton;
}
