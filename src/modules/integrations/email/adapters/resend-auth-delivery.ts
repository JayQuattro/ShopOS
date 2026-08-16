import type {
  AuthDeliveryMessage,
  AuthDeliveryProvider,
} from "@/modules/identity/delivery/auth-delivery-provider";
import type { ResendConfiguration, ResendSecret } from "./adapter-types";

/**
 * Resend adapter implementing the pre-tenant AuthDeliveryProvider interface.
 *
 * Uses the Resend REST API via fetch (no SDK dependency). Fire-and-forget
 * per the interface contract.
 */
export class ResendAuthDeliveryProvider implements AuthDeliveryProvider {
  readonly key = "resend";

  constructor(
    private readonly config: ResendConfiguration,
    private readonly secret: ResendSecret,
  ) {}

  send(message: AuthDeliveryMessage): void {
    const subject = buildSubject(message);
    const text = buildTextBody(message);
    const from = this.config.fromName
      ? `${this.config.fromName} <${this.config.fromAddress}>`
      : this.config.fromAddress;

    void fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.secret.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [message.to],
        subject,
        text,
      }),
    })
      .then(() => undefined)
      .catch(() => undefined);
  }

  async verify(): Promise<boolean> {
    try {
      const res = await fetch("https://api.resend.com/domains", {
        headers: { Authorization: `Bearer ${this.secret.apiKey}` },
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}

function buildSubject(message: AuthDeliveryMessage): string {
  switch (message.kind) {
    case "verification-email":
      return "Verify your email address";
    case "password-reset-email":
      return "Reset your password";
    case "magic-link-email":
      return "Sign in to ShopOS";
    case "email-otp":
      return "Your sign-in code";
    case "two-factor-otp":
      return "Your verification code";
    default:
      return "ShopOS";
  }
}

function buildTextBody(message: AuthDeliveryMessage): string {
  const m = message as { url?: string; otp?: string };
  if (m.url) {
    return `Click the link to continue: ${m.url}`;
  }
  if (m.otp) {
    return `Your code is: ${m.otp}`;
  }
  return "Open ShopOS to continue.";
}
